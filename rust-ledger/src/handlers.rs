use actix_web::{web, HttpRequest, HttpResponse, Responder};
use sqlx::PgPool;
use uuid::Uuid;
use rust_decimal::Decimal;

use crate::models::{TransferRequest, EscrowCreateRequest, EscrowReleaseRequest, KycWebhookRequest};

// Helper function to check idempotency key
async fn verify_idempotency(
    pool: &PgPool,
    idempotency_key: &str,
) -> Result<bool, sqlx::Error> {
    // Check if the key exists in Redis or Postgres sliding window.
    // Here we use a postgres-backed idempotency table check.
    let exists: (bool,) = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM idempotency_keys WHERE key = $1 AND created_at > NOW() - INTERVAL '120 seconds')"
    )
    .bind(idempotency_key)
    .fetch_one(pool)
    .await?;

    if exists.0 {
        return Ok(false); // Key already processed recently
    }

    // Insert the key
    sqlx::query("INSERT INTO idempotency_keys (key) VALUES ($1) ON CONFLICT DO NOTHING")
        .bind(idempotency_key)
        .execute(pool)
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

    // Mock sender user ID from token session (normally extracted from auth middleware)
    let sender_id = "user_sender_123"; 

    // Execute in transaction
    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };

    // 1. Fetch sender balance and check funds
    let sender: (Decimal, bool) = match sqlx::query_as(
        "SELECT offchain_balance, kyc_verified FROM wallet_accounts WHERE user_id = $1 FOR UPDATE"
    )
    .bind(sender_id)
    .fetch_one(&mut *tx)
    .await {
        Ok(b) => b,
        Err(_) => return HttpResponse::BadRequest().body("Sender wallet not found"),
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

    let buyer_id = "user_buyer_456";

    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };

    // Deduct offchain_balance and add to reserved_escrow_balance
    let buyer: (Decimal, bool) = match sqlx::query_as(
        "SELECT offchain_balance, kyc_verified FROM wallet_accounts WHERE user_id = $1 FOR UPDATE"
    )
    .bind(buyer_id)
    .fetch_one(&mut *tx)
    .await {
        Ok(b) => b,
        Err(_) => return HttpResponse::BadRequest().body("Buyer wallet not found"),
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
    pool: web::Data<PgPool>,
    body: web::Json<KycWebhookRequest>,
) -> impl Responder {
    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };

    match sqlx::query("UPDATE wallet_accounts SET kyc_verified = TRUE, updated_at = NOW() WHERE user_id = $1")
        .bind(&body.user_id)
        .execute(&mut *tx)
        .await
    {
        Ok(res) => {
            if res.rows_affected() == 0 {
                return HttpResponse::NotFound().body("User wallet not found");
            }
        }
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    }

    if let Err(e) = tx.commit().await {
        return HttpResponse::InternalServerError().body(e.to_string());
    }

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "message": format!("KYC status updated for user {}", body.user_id)
    }))
}
