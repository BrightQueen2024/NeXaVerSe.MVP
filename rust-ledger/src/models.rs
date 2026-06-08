use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::NaiveDateTime;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct WalletAccount {
    pub id: Uuid,
    pub user_id: String,
    pub public_key: String,
    pub offchain_balance: rust_decimal::Decimal,
    pub reserved_escrow_balance: rust_decimal::Decimal,
    pub kyc_verified: bool,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct TransactionOutbox {
    pub id: Uuid,
    pub tx_type: String, // "TRANSFER", "ESCROW_LOCK", "ESCROW_RELEASE"
    pub sender_address: String,
    pub receiver_address: String,
    pub amount: rust_decimal::Decimal,
    pub payload: Option<serde_json::Value>,
    pub status: String, // "PENDING", "PROCESSING", "SETTLED", "FAILED"
    pub l2_tx_hash: Option<String>,
    pub retry_count: i32,
    pub created_at: NaiveDateTime,
    pub processed_at: Option<NaiveDateTime>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct EscrowRecord {
    pub id: Uuid,
    pub order_id: String,
    pub buyer_id: String,
    pub seller_id: String,
    pub amount: rust_decimal::Decimal,
    pub state: String, // "LOCKED", "RELEASED", "DISPUTED", "REFUNDED"
    pub multi_sig_signature: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

// Request and Response schemas for endpoints
#[derive(Debug, Deserialize)]
pub struct TransferRequest {
    pub receiver_id: String,
    pub amount: rust_decimal::Decimal,
}

#[derive(Debug, Deserialize)]
pub struct EscrowCreateRequest {
    pub order_id: String,
    pub seller_id: String,
    pub amount: rust_decimal::Decimal,
}

#[derive(Debug, Deserialize)]
pub struct EscrowReleaseRequest {
    pub signature: String,
}
