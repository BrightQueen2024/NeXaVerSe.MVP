use actix_web::{web, App, HttpServer, middleware::Logger};
use sqlx::postgres::{PgPoolOptions, PgConnectOptions};
use std::env;
use std::str::FromStr;

mod models;
mod handlers;
mod batcher;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenvy::dotenv().ok();
    env_logger::init_from_env(env_logger::Env::new().default_filter_or("info"));

    let db_url = env::var("DATABASE_URL").unwrap_or_else(|_| {
        "postgres://postgres:postgres@localhost:5432/nexaverse".to_string()
    });

    let connection_options = PgConnectOptions::from_str(&db_url)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;

    let mut pool = None;
    let max_attempts = 5;
    let delay = std::time::Duration::from_secs(2);

    for attempt in 1..=max_attempts {
        log::info!("Connecting to PostgreSQL database (attempt {}/{})...", attempt, max_attempts);
        match PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(std::time::Duration::from_secs(3))
            .connect_with(connection_options.clone())
            .await
        {
            Ok(p) => {
                pool = Some(p);
                break;
            }
            Err(e) => {
                log::warn!("Connection attempt {} failed: {}.", attempt, e);
                if attempt < max_attempts {
                    log::info!("Retrying in 2 seconds...");
                    tokio::time::sleep(delay).await;
                } else {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::ConnectionRefused,
                        format!("Failed to connect to database after {} attempts: {}", max_attempts, e),
                    ));
                }
            }
        }
    }
    let pool = pool.unwrap();

    // Perform database schema creation
    bootstrap_db(&pool).await;

    // Start background transaction batcher task
    let batcher_pool = pool.clone();
    tokio::spawn(async move {
        let batcher = batcher::L2Batcher::new(batcher_pool);
        batcher.start().await;
    });

    let port = env::var("PORT").unwrap_or_else(|_| "8081".to_string());
    log::info!("Starting Actix HTTP server on port {}...", port);

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(pool.clone()))
            .wrap(Logger::default())
            .route("/wallet/transfer", web::post().to(handlers::wallet_transfer))
            .route("/wallet/kyc-webhook", web::post().to(handlers::kyc_webhook))
            .route("/wallet/transactions", web::get().to(handlers::wallet_transactions))
            .route("/escrow/create", web::post().to(handlers::escrow_create))
            .route("/escrow/release/{id}", web::post().to(handlers::escrow_release))
            .route("/staking/stake", web::post().to(handlers::staking_stake))
            .route("/staking/unstake", web::post().to(handlers::staking_unstake))
            .route("/staking/claim", web::post().to(handlers::staking_claim))
            .route("/staking/dashboard/{user_id}", web::get().to(handlers::staking_dashboard))
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}

async fn bootstrap_db(pool: &sqlx::PgPool) {
    log::info!("Bootstrapping PostgreSQL database schema if missing...");
    let mut conn = pool.acquire().await.expect("Failed to acquire DB connection for bootstrap");
    
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS wallet_accounts (
            id UUID PRIMARY KEY,
            user_id VARCHAR(255) UNIQUE NOT NULL,
            public_key VARCHAR(255) NOT NULL,
            offchain_balance NUMERIC(20, 8) DEFAULT 0.0,
            reserved_escrow_balance NUMERIC(20, 8) DEFAULT 0.0,
            kyc_verified BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
         )"
    ).execute(&mut *conn).await.unwrap();

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS transaction_outbox (
            id UUID PRIMARY KEY,
            tx_type VARCHAR(50) NOT NULL,
            sender_address VARCHAR(255) NOT NULL,
            receiver_address VARCHAR(255) NOT NULL,
            amount NUMERIC(20, 8) NOT NULL,
            payload JSONB,
            status VARCHAR(50) NOT NULL,
            l2_tx_hash VARCHAR(255),
            retry_count INT DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            processed_at TIMESTAMP
         )"
    ).execute(&mut *conn).await.unwrap();

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS escrow_records (
            id UUID PRIMARY KEY,
            order_id VARCHAR(255) NOT NULL,
            buyer_id VARCHAR(255) NOT NULL,
            seller_id VARCHAR(255) NOT NULL,
            amount NUMERIC(20, 8) NOT NULL,
            state VARCHAR(50) NOT NULL,
            multi_sig_signature TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
         )"
    ).execute(&mut *conn).await.unwrap();

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS idempotency_keys (
            key VARCHAR(255) PRIMARY KEY,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
         )"
    ).execute(&mut *conn).await.unwrap();

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS staking_positions (
            id UUID PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            staked_amount NUMERIC(20, 8) NOT NULL,
            tier VARCHAR(50) NOT NULL,
            lock_start TIMESTAMP NOT NULL DEFAULT NOW(),
            lock_end TIMESTAMP NOT NULL,
            status VARCHAR(50) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
         )"
    ).execute(&mut *conn).await.unwrap();

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS staking_rewards (
            id UUID PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            reward_amount NUMERIC(20, 8) NOT NULL,
            claimed BOOLEAN DEFAULT FALSE,
            accrued_at TIMESTAMP NOT NULL DEFAULT NOW(),
            claimed_at TIMESTAMP
         )"
    ).execute(&mut *conn).await.unwrap();

    log::info!("Database schema up to date.");
}
