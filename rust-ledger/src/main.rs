use actix_web::{web, App, HttpServer, middleware::Logger};
use sqlx::postgres::PgPoolOptions;
use std::env;

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

    log::info!("Connecting to PostgreSQL database...");
    let pool = PgPoolOptions::new()
        .max_connections(50)
        .connect(&db_url)
        .await
        .expect("Failed to connect to database");

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
            .route("/escrow/create", web::post().to(handlers::escrow_create))
            .route("/escrow/release/{id}", web::post().to(handlers::escrow_release))
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}

async fn bootstrap_db(pool: &sqlx::PgPool) {
    log::info!("Bootstrapping PostgreSQL database schema if missing...");
    
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
    ).execute(pool).await.unwrap();

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
    ).execute(pool).await.unwrap();

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
    ).execute(pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS idempotency_keys (
            key VARCHAR(255) PRIMARY KEY,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
         )"
    ).execute(pool).await.unwrap();

    log::info!("Database schema up to date.");
}
