use actix_web::{web, HttpRequest, HttpResponse, Responder};
use sqlx::PgPool;
use uuid::Uuid;
use rust_decimal::Decimal;

use crate::models::{TransferRequest, EscrowCreateRequest, EscrowReleaseRequest, KycWebhookRequest, StakeRequest, UnstakeRequest};

// Helper function to check idempotency key
async fn verify_idempotency(
    pool: &PgPool,
    idempotency_key: &str,
) -> Result<bool, sqlx::Error> {
    // Check if the key exists in Redis or Postgres sliding window.
    // Here we use a postgres-backed idempotency table check.
    let mut conn = pool.acquire().await?;
    let exists: (bool,) = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM idempotency_keys WHERE key = $1 AND created_at > NOW() - INTERVAL '120 seconds')"
    )
    .bind(idempotency_key)
    .fetch_one(&mut *conn)
    .await?;

    if exists.0 {
        return Ok(false); // Key already processed recently
    }

    // Insert the key
    sqlx::query("INSERT INTO idempotency_keys (key) VALUES ($1) ON CONFLICT DO NOTHING")
        .bind(idempotency_key)
        .execute(&mut *conn)
        .await?;

    Ok(true)
}

pub async fn wallet_transfer(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    body: web::Json<TransferRequest>,
) -> impl Responder {
    let idempotency_key = match req.headers().get("X-Idempotency-Key") {
        Some(val) => val.to_str().unwrap_or(""),
        None => return HttpResponse::BadRequest().body("Missing X-Idempotency-Key header"),
    };

    if idempotency_key.is_empty() {
        return HttpResponse::BadRequest().body("Invalid X-Idempotency-Key");
    }

    // Idempotency Lock Check
    match verify_idempotency(&pool, idempotency_key).await {
        Ok(true) => {}
        Ok(false) => return HttpResponse::Conflict().body("Duplicate transaction request"),
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    }

    let sender_id = match req.headers().get("X-User-Id") {
        Some(val) => val.to_str().unwrap_or("user_sender_123"),
        None => "user_sender_123",
    };

    // Execute in transaction
    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };

    // 1. Fetch sender balance, auto-provision with default balance if not exists
    let sender: (Decimal, bool) = match sqlx::query_as(
        "SELECT offchain_balance, kyc_verified FROM wallet_accounts WHERE user_id = $1 FOR UPDATE"
    )
    .bind(sender_id)
    .fetch_one(&mut *tx)
    .await {
        Ok(b) => b,
        Err(_) => {
            let new_id = Uuid::new_v4();
            if let Err(e) = sqlx::query(
                "INSERT INTO wallet_accounts (id, user_id, public_key, offchain_balance, kyc_verified)
                 VALUES ($1, $2, 'ssh-ed25519-placeholder-key', 5000.00, FALSE)"
            )
            .bind(new_id)
            .bind(sender_id)
            .execute(&mut *tx)
            .await {
                return HttpResponse::InternalServerError().body(e.to_string());
            }
            (Decimal::new(5000, 0), false)
        }
    };

    let (offchain_balance, kyc_verified) = sender;
    if offchain_balance < body.amount {
        return HttpResponse::BadRequest().body("Insufficient funds");
    }

    // Enforce KYC check for high-value transactions (> 1000 NEXA)
    let kyc_threshold = Decimal::new(1000, 0);
    if body.amount > kyc_threshold && !kyc_verified {
        return HttpResponse::Forbidden().body("Transaction exceeds unverified threshold (1000 NEXA). Please complete face/biometric KYC.");
    }

    // Make sure receiver wallet exists, auto-provision if not exists
    let receiver_exists: (bool,) = match sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM wallet_accounts WHERE user_id = $1)"
    )
    .bind(&body.receiver_id)
    .fetch_one(&mut *tx)
    .await {
        Ok(r) => r,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };

    if !receiver_exists.0 {
        let new_id = Uuid::new_v4();
        if let Err(e) = sqlx::query(
            "INSERT INTO wallet_accounts (id, user_id, public_key, offchain_balance, kyc_verified)
             VALUES ($1, $2, 'ssh-ed25519-placeholder-key', 0.00, FALSE)"
        )
        .bind(new_id)
        .bind(&body.receiver_id)
        .execute(&mut *tx)
        .await {
            return HttpResponse::InternalServerError().body(e.to_string());
        }
    }

    // 2. Deduct from sender
    if let Err(e) = sqlx::query(
        "UPDATE wallet_accounts SET offchain_balance = offchain_balance - $1 WHERE user_id = $2"
    )
    .bind(body.amount)
    .bind(sender_id)
    .execute(&mut *tx)
    .await {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    // 3. Add to receiver
    if let Err(e) = sqlx::query(
        "UPDATE wallet_accounts SET offchain_balance = offchain_balance + $1 WHERE user_id = $2"
    )
    .bind(body.amount)
    .bind(&body.receiver_id)
    .execute(&mut *tx)
    .await {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    // 4. Write to transaction outbox for on-chain batching/settlement
    let outbox_id = Uuid::new_v4();
    if let Err(e) = sqlx::query(
        "INSERT INTO transaction_outbox (id, tx_type, sender_address, receiver_address, amount, status)
         VALUES ($1, 'TRANSFER', $2, $3, $4, 'PENDING')"
    )
    .bind(outbox_id)
    .bind(sender_id)
    .bind(&body.receiver_id)
    .bind(body.amount)
    .execute(&mut *tx)
    .await {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    // Commit Transaction
    if let Err(e) = tx.commit().await {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "outbox_id": outbox_id.to_string(),
        "message": "Transfer processed off-chain, queued for settlement."
    }))
}

pub async fn escrow_create(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    body: web::Json<EscrowCreateRequest>,
) -> impl Responder {
    let idempotency_key = match req.headers().get("X-Idempotency-Key") {
        Some(val) => val.to_str().unwrap_or(""),
        None => return HttpResponse::BadRequest().body("Missing X-Idempotency-Key header"),
    };

    if idempotency_key.is_empty() {
        return HttpResponse::BadRequest().body("Invalid X-Idempotency-Key");
    }

    match verify_idempotency(&pool, idempotency_key).await {
        Ok(true) => {}
        Ok(false) => return HttpResponse::Conflict().body("Duplicate transaction request"),
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    }

    let buyer_id = match req.headers().get("X-User-Id") {
        Some(val) => val.to_str().unwrap_or("user_buyer_456"),
        None => "user_buyer_456",
    };

    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };

    // Deduct offchain_balance and add to reserved_escrow_balance, auto-provision with default balance if not exists
    let buyer: (Decimal, bool) = match sqlx::query_as(
        "SELECT offchain_balance, kyc_verified FROM wallet_accounts WHERE user_id = $1 FOR UPDATE"
    )
    .bind(buyer_id)
    .fetch_one(&mut *tx)
    .await {
        Ok(b) => b,
        Err(_) => {
            let new_id = Uuid::new_v4();
            if let Err(e) = sqlx::query(
                "INSERT INTO wallet_accounts (id, user_id, public_key, offchain_balance, kyc_verified)
                 VALUES ($1, $2, 'ssh-ed25519-placeholder-key', 5000.00, FALSE)"
            )
            .bind(new_id)
            .bind(buyer_id)
            .execute(&mut *tx)
            .await {
                return HttpResponse::InternalServerError().body(e.to_string());
            }
            (Decimal::new(5000, 0), false)
        }
    };

    let (offchain_balance, kyc_verified) = buyer;
    if offchain_balance < body.amount {
        return HttpResponse::BadRequest().body("Insufficient balance to lock in escrow");
    }

    // Enforce KYC check for high-value transactions (> 1000 NEXA)
    let kyc_threshold = Decimal::new(1000, 0);
    if body.amount > kyc_threshold && !kyc_verified {
        return HttpResponse::Forbidden().body("Escrow lock amount exceeds unverified threshold (1000 NEXA). Please complete face/biometric KYC.");
    }

    // Make sure seller wallet exists, auto-provision if not exists
    let seller_exists: (bool,) = match sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM wallet_accounts WHERE user_id = $1)"
    )
    .bind(&body.seller_id)
    .fetch_one(&mut *tx)
    .await {
        Ok(r) => r,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };

    if !seller_exists.0 {
        let new_id = Uuid::new_v4();
        if let Err(e) = sqlx::query(
            "INSERT INTO wallet_accounts (id, user_id, public_key, offchain_balance, kyc_verified)
             VALUES ($1, $2, 'ssh-ed25519-placeholder-key', 0.00, FALSE)"
        )
        .bind(new_id)
        .bind(&body.seller_id)
        .execute(&mut *tx)
        .await {
            return HttpResponse::InternalServerError().body(e.to_string());
        }
    }

    sqlx::query(
        "UPDATE wallet_accounts 
         SET offchain_balance = offchain_balance - $1, reserved_escrow_balance = reserved_escrow_balance + $1 
         WHERE user_id = $2"
    )
    .bind(body.amount)
    .bind(buyer_id)
    .execute(&mut *tx)
    .await.unwrap();

    // Create escrow record
    let escrow_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO escrow_records (id, order_id, buyer_id, seller_id, amount, state)
         VALUES ($1, $2, $3, $4, $5, 'LOCKED')"
    )
    .bind(escrow_id)
    .bind(&body.order_id)
    .bind(buyer_id)
    .bind(&body.seller_id)
    .bind(body.amount)
    .execute(&mut *tx)
    .await.unwrap();

    // Write to transaction outbox for on-chain smart contract locking
    sqlx::query(
        "INSERT INTO transaction_outbox (id, tx_type, sender_address, receiver_address, amount, status, payload)
         VALUES ($1, 'ESCROW_LOCK', $2, $3, $4, 'PENDING', $5)"
    )
    .bind(Uuid::new_v4())
    .bind(buyer_id)
    .bind(&body.seller_id)
    .bind(body.amount)
    .bind(serde_json::json!({ "escrow_id": escrow_id.to_string(), "order_id": body.order_id }))
    .execute(&mut *tx)
    .await.unwrap();

    tx.commit().await.unwrap();

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "escrow_id": escrow_id.to_string(),
        "state": "LOCKED",
        "message": "Funds locked in escrow off-chain, settlement pending."
    }))
}

pub async fn escrow_release(
    path: web::Path<Uuid>,
    pool: web::Data<PgPool>,
    body: web::Json<EscrowReleaseRequest>,
) -> impl Responder {
    let escrow_id = path.into_inner();

    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };

    // Fetch escrow record
    let escrow: crate::models::EscrowRecord = match sqlx::query_as(
        "SELECT * FROM escrow_records WHERE id = $1 FOR UPDATE"
    )
    .bind(escrow_id)
    .fetch_one(&mut *tx)
    .await {
        Ok(rec) => rec,
        Err(_) => return HttpResponse::NotFound().body("Escrow record not found"),
    };

    if escrow.state != "LOCKED" {
        return HttpResponse::BadRequest().body("Escrow is not in LOCKED state");
    }

    // Verify multi-sig delivery signature (cryptographic check stubbed for production hardware integration)
    log::info!("Verifying multi-sig delivery signature: {}", body.signature);

    // Update escrow state
    sqlx::query("UPDATE escrow_records SET state = 'RELEASED', multi_sig_signature = $1 WHERE id = $2")
        .bind(&body.signature)
        .bind(escrow_id)
        .execute(&mut *tx)
        .await.unwrap();

    // Release reserved escrow balance from buyer and credit off-chain balance to seller
    sqlx::query(
        "UPDATE wallet_accounts SET reserved_escrow_balance = reserved_escrow_balance - $1 WHERE user_id = $2"
    )
    .bind(escrow.amount)
    .bind(&escrow.buyer_id)
    .execute(&mut *tx)
    .await.unwrap();

    sqlx::query(
        "UPDATE wallet_accounts SET offchain_balance = offchain_balance + $1 WHERE user_id = $2"
    )
    .bind(escrow.amount)
    .bind(&escrow.seller_id)
    .execute(&mut *tx)
    .await.unwrap();

    // Log to transaction outbox for on-chain settlement release
    sqlx::query(
        "INSERT INTO transaction_outbox (id, tx_type, sender_address, receiver_address, amount, status, payload)
         VALUES ($1, 'ESCROW_RELEASE', $2, $3, $4, 'PENDING', $5)"
    )
    .bind(Uuid::new_v4())
    .bind(&escrow.buyer_id)
    .bind(&escrow.seller_id)
    .bind(escrow.amount)
    .bind(serde_json::json!({ "escrow_id": escrow_id.to_string(), "signature": body.signature }))
    .execute(&mut *tx)
    .await.unwrap();

    tx.commit().await.unwrap();

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "escrow_id": escrow_id.to_string(),
        "state": "RELEASED",
        "message": "Escrow released off-chain. Queue processing on-chain."
    }))
}

pub async fn kyc_webhook(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    body: web::Json<KycWebhookRequest>,
) -> impl Responder {
    // Zero-Trust internal authorization check
    let internal_secret = std::env::var("INTERNAL_SERVICE_SECRET").unwrap_or_else(|_| "dev-secret-token".to_string());
    let incoming_token = match req.headers().get("X-Internal-Token") {
        Some(val) => val.to_str().unwrap_or(""),
        None => return HttpResponse::Unauthorized().body("Missing X-Internal-Token header"),
    };

    if incoming_token != internal_secret {
        return HttpResponse::Unauthorized().body("Invalid internal service token");
    }

    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };

    let rows_affected = match sqlx::query("UPDATE wallet_accounts SET kyc_verified = TRUE, updated_at = NOW() WHERE user_id = $1")
        .bind(&body.user_id)
        .execute(&mut *tx)
        .await
    {
        Ok(res) => res.rows_affected(),
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };

    if rows_affected == 0 {
        // Auto-provision wallet account on KYC webhook success
        let new_id = Uuid::new_v4();
        if let Err(e) = sqlx::query(
            "INSERT INTO wallet_accounts (id, user_id, public_key, offchain_balance, kyc_verified)
             VALUES ($1, $2, 'ssh-ed25519-placeholder-key', 5000.00, TRUE)"
        )
        .bind(new_id)
        .bind(&body.user_id)
        .execute(&mut *tx)
        .await {
            return HttpResponse::InternalServerError().body(e.to_string());
        }
    }

    if let Err(e) = tx.commit().await {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "message": format!("KYC status updated for user {}", body.user_id)
      }))
}

pub async fn staking_stake(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    body: web::Json<StakeRequest>,
) -> impl Responder {
    let user_id = match req.headers().get("X-User-Id") {
        Some(val) => val.to_str().unwrap_or("user_sender_123"),
        None => "user_sender_123",
    };

    if body.amount <= rust_decimal::Decimal::ZERO {
        return HttpResponse::BadRequest().body("Staking amount must be greater than zero");
    }

    let lock_days = body.lock_days;
    if lock_days != 30 && lock_days != 90 && lock_days != 180 && lock_days != 360 {
        return HttpResponse::BadRequest().body("Invalid lock duration. Must be 30, 90, 180, or 360 days.");
    }

    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };

    // 1. Fetch user wallet balance
    let user_wallet: (Decimal, bool) = match sqlx::query_as(
        "SELECT offchain_balance, kyc_verified FROM wallet_accounts WHERE user_id = $1 FOR UPDATE"
    )
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await {
        Ok(b) => b,
        Err(_) => {
            let new_id = Uuid::new_v4();
            if let Err(e) = sqlx::query(
                "INSERT INTO wallet_accounts (id, user_id, public_key, offchain_balance, kyc_verified)
                 VALUES ($1, $2, 'ssh-ed25519-placeholder-key', 5000.00, FALSE)"
            )
            .bind(new_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await {
                return HttpResponse::InternalServerError().body(e.to_string());
            }
            (Decimal::new(5000, 0), false)
        }
    };

    let (offchain_balance, _kyc_verified) = user_wallet;
    if offchain_balance < body.amount {
        return HttpResponse::BadRequest().body("Insufficient funds to stake");
    }

    // 2. Map tier and APY
    let (tier, apy_pct) = match lock_days {
        30 => ("BRONZE", 5),
        90 => ("SILVER", 8),
        180 => ("GOLD", 12),
        360 => ("PLATINUM", 18),
        _ => ("BRONZE", 5)
    };

    let position_id = Uuid::new_v4();
    let now = chrono::Utc::now().naive_utc();
    let lock_end = now + chrono::Duration::days(lock_days as i64);

    // 3. Deduct balance and update database
    if let Err(e) = sqlx::query(
        "UPDATE wallet_accounts 
         SET offchain_balance = offchain_balance - $1, reserved_escrow_balance = reserved_escrow_balance + $1 
         WHERE user_id = $2"
    )
    .bind(body.amount)
    .bind(user_id)
    .execute(&mut *tx)
    .await {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    if let Err(e) = sqlx::query(
        "INSERT INTO staking_positions (id, user_id, staked_amount, tier, lock_start, lock_end, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')"
    )
    .bind(position_id)
    .bind(user_id)
    .bind(body.amount)
    .bind(tier)
    .bind(now)
    .bind(lock_end)
    .execute(&mut *tx)
    .await {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    // Queue in transactional outbox for smart contract interaction
    if let Err(e) = sqlx::query(
        "INSERT INTO transaction_outbox (id, tx_type, sender_address, receiver_address, amount, status, payload)
         VALUES ($1, 'STAKE', $2, '0x-staking-contract-address', $3, 'PENDING', $4)"
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(body.amount)
    .bind(serde_json::json!({
        "position_id": position_id.to_string(),
        "lock_days": lock_days,
        "apy": apy_pct
    }))
    .execute(&mut *tx)
    .await {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    if let Err(e) = tx.commit().await {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "position_id": position_id.to_string(),
        "tier": tier,
        "amount": body.amount,
        "lock_end": lock_end.format("%Y-%m-%d %H:%M:%S").to_string()
    }))
}

pub async fn staking_unstake(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    body: web::Json<UnstakeRequest>,
) -> impl Responder {
    let user_id = match req.headers().get("X-User-Id") {
        Some(val) => val.to_str().unwrap_or("user_sender_123"),
        None => "user_sender_123",
    };

    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };

    // 1. Fetch staking position
    let position: crate::models::StakingPosition = match sqlx::query_as(
        "SELECT * FROM staking_positions WHERE id = $1 FOR UPDATE"
    )
    .bind(body.position_id)
    .fetch_one(&mut *tx)
    .await {
        Ok(p) => p,
        Err(_) => return HttpResponse::NotFound().body("Staking position not found"),
    };

    if position.user_id != user_id {
        return HttpResponse::Forbidden().body("Unauthorized to modify this staking position");
    }

    if position.status != "ACTIVE" {
        return HttpResponse::BadRequest().body("Staking position is already unstaked");
    }

    let now = chrono::Utc::now().naive_utc();
    let principal = position.staked_amount;
    let mut returned_amount = principal;
    let mut penalty = Decimal::ZERO;
    let mut final_status = "UNSTAKED";

    // 2. Early withdrawal penalty check (15%)
    if now < position.lock_end {
        let penalty_pct = Decimal::new(15, 2); // 0.15
        penalty = principal * penalty_pct;
        returned_amount = principal - penalty;
        final_status = "EARLY_WITHDRAWAL";
    }

    // 3. Update wallet accounts (deduct reserved, add principal/net to offchain)
    if let Err(e) = sqlx::query(
        "UPDATE wallet_accounts 
         SET reserved_escrow_balance = reserved_escrow_balance - $1,
             offchain_balance = offchain_balance + $2 
         WHERE user_id = $3"
    )
    .bind(principal)
    .bind(returned_amount)
    .bind(user_id)
    .execute(&mut *tx)
    .await {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    // Update position status
    if let Err(e) = sqlx::query(
        "UPDATE staking_positions SET status = $1 WHERE id = $2"
    )
    .bind(final_status)
    .bind(body.position_id)
    .execute(&mut *tx)
    .await {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    // Queue in transaction outbox
    if let Err(e) = sqlx::query(
        "INSERT INTO transaction_outbox (id, tx_type, sender_address, receiver_address, amount, status, payload)
         VALUES ($1, 'UNSTAKE', $2, '0x-staking-contract-address', $3, 'PENDING', $4)"
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(returned_amount)
    .bind(serde_json::json!({
        "position_id": position.id.to_string(),
        "penalty_amount": penalty,
        "early": now < position.lock_end
    }))
    .execute(&mut *tx)
    .await {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    if let Err(e) = tx.commit().await {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "position_id": position.id.to_string(),
        "principal_staked": principal,
        "principal_returned": returned_amount,
        "penalty_applied": penalty,
        "final_status": final_status
    }))
}

pub async fn staking_claim(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    body: web::Json<UnstakeRequest>, // Reuse position ID
) -> impl Responder {
    let user_id = match req.headers().get("X-User-Id") {
        Some(val) => val.to_str().unwrap_or("user_sender_123"),
        None => "user_sender_123",
    };

    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };

    // 1. Fetch staking position
    let position: crate::models::StakingPosition = match sqlx::query_as(
        "SELECT * FROM staking_positions WHERE id = $1 FOR UPDATE"
    )
    .bind(body.position_id)
    .fetch_one(&mut *tx)
    .await {
        Ok(p) => p,
        Err(_) => return HttpResponse::NotFound().body("Staking position not found"),
    };

    if position.user_id != user_id {
        return HttpResponse::Forbidden().body("Unauthorized to modify this staking position");
    }

    if position.status != "ACTIVE" {
        return HttpResponse::BadRequest().body("Cannot claim yields on inactive position");
    }

    // 2. Fetch last claim date or calculate elapsed duration
    let now = chrono::Utc::now().naive_utc();
    let start_date = position.lock_start;
    let end_date = position.lock_end;
    let calculate_end = if now > end_date { end_date } else { now };

    if start_date >= calculate_end {
        return HttpResponse::Ok().json(serde_json::json!({ "claimed_amount": 0.00, "message": "No accrued yield to claim." }));
    }

    let apy_pct = match position.tier.as_str() {
        "BRONZE" => Decimal::new(5, 2), // 0.05
        "SILVER" => Decimal::new(8, 2), // 0.08
        "GOLD" => Decimal::new(12, 2), // 0.12
        "PLATINUM" => Decimal::new(18, 2), // 0.18
        _ => Decimal::new(5, 2)
    };

    let total_seconds = (calculate_end - start_date).num_seconds();
    let seconds_in_year = 365 * 24 * 3600;
    
    let time_fraction = Decimal::from(total_seconds) / Decimal::from(seconds_in_year);
    let accrued_yield = position.staked_amount * apy_pct * time_fraction;

    if accrued_yield <= Decimal::ZERO {
        return HttpResponse::Ok().json(serde_json::json!({ "claimed_amount": 0.00, "message": "accrued yield is zero" }));
    }

    // 3. Update user offchain balance
    if let Err(e) = sqlx::query(
        "UPDATE wallet_accounts SET offchain_balance = offchain_balance + $1 WHERE user_id = $2"
    )
    .bind(accrued_yield)
    .bind(user_id)
    .execute(&mut *tx)
    .await {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    // Reset position lock_start to now (to block claiming the same yield slot)
    if let Err(e) = sqlx::query(
        "UPDATE staking_positions SET lock_start = $1 WHERE id = $2"
    )
    .bind(now)
    .bind(body.position_id)
    .execute(&mut *tx)
    .await {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    // Insert rewards log
    let reward_id = Uuid::new_v4();
    if let Err(e) = sqlx::query(
        "INSERT INTO staking_rewards (id, user_id, reward_amount, claimed, accrued_at, claimed_at)
         VALUES ($1, $2, $3, TRUE, $4, $4)"
    )
    .bind(reward_id)
    .bind(user_id)
    .bind(accrued_yield)
    .bind(now)
    .execute(&mut *tx)
    .await {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    if let Err(e) = tx.commit().await {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "position_id": position.id.to_string(),
        "claimed_amount": accrued_yield,
        "message": "Staking reward claimed successfully."
    }))
}

pub async fn staking_dashboard(
    path: web::Path<String>,
    pool: web::Data<PgPool>,
) -> impl Responder {
    let user_id = path.into_inner();

    let mut conn = match pool.acquire().await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };

    // Fetch active positions
    let positions: Vec<crate::models::StakingPosition> = match sqlx::query_as(
        "SELECT * FROM staking_positions WHERE user_id = $1 AND status = 'ACTIVE'"
    )
    .bind(&user_id)
    .fetch_all(&mut *conn)
    .await {
        Ok(pos) => pos,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };

    let total_staked: Decimal = positions.iter().map(|p| p.staked_amount).sum();

    // Determine current tier (highest active)
    let mut active_tier = "NONE";
    let mut highest_apy = Decimal::ZERO;

    for pos in &positions {
        let apy = match pos.tier.as_str() {
            "BRONZE" => Decimal::new(5, 2),
            "SILVER" => Decimal::new(8, 2),
            "GOLD" => Decimal::new(12, 2),
            "PLATINUM" => Decimal::new(18, 2),
            _ => Decimal::new(5, 2)
        };
        if apy > highest_apy {
            highest_apy = apy;
            active_tier = pos.tier.as_str();
        }
    }

    // Calculate dynamic yield accrued across positions
    let now = chrono::Utc::now().naive_utc();
    let mut total_accrued = Decimal::ZERO;
    let seconds_in_year = 365 * 24 * 3600;

    for pos in &positions {
        let apy_pct = match pos.tier.as_str() {
            "BRONZE" => Decimal::new(5, 2),
            "SILVER" => Decimal::new(8, 2),
            "GOLD" => Decimal::new(12, 2),
            "PLATINUM" => Decimal::new(18, 2),
            _ => Decimal::new(5, 2)
        };

        let calculate_end = if now > pos.lock_end { pos.lock_end } else { now };
        if pos.lock_start < calculate_end {
            let elapsed_seconds = (calculate_end - pos.lock_start).num_seconds();
            let time_fraction = Decimal::from(elapsed_seconds) / Decimal::from(seconds_in_year);
            total_accrued += pos.staked_amount * apy_pct * time_fraction;
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "user_id": user_id,
        "total_staked": total_staked,
        "current_tier": active_tier,
        "apy": highest_apy * Decimal::new(100, 0),
        "rewards_accrued": total_accrued,
        "positions_count": positions.len()
    }))
}

pub async fn wallet_transactions(
    pool: web::Data<PgPool>,
) -> impl Responder {
    let mut conn = match pool.acquire().await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };

    let records = match sqlx::query!(
        "SELECT id, tx_type, sender_address, receiver_address, amount, status, created_at FROM transaction_outbox ORDER BY created_at DESC LIMIT 100"
    )
    .fetch_all(&mut *conn)
    .await {
        Ok(r) => r,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };

    let list: Vec<serde_json::Value> = records.into_iter().map(|r| {
        serde_json::json!({
            "id": r.id,
            "tx_type": r.tx_type,
            "sender_address": r.sender_address,
            "receiver_address": r.receiver_address,
            "amount": r.amount,
            "status": r.status,
            "created_at": r.created_at
        })
    }).collect();

    HttpResponse::Ok().json(list)
}

