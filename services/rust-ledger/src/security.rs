use std::time::{SystemTime, UNIX_EPOCH};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use actix_web::{
    dev::ServiceRequest,
    HttpResponse,
};

type HmacSha256 = Hmac<Sha256>;

pub fn validate_internal_request(req: &ServiceRequest) -> Result<(), HttpResponse> {
    // 1. Get INTERNAL_CLUSTER_SECRET
    let secret_key = std::env::var("INTERNAL_CLUSTER_SECRET")
        .unwrap_or_else(|_| "nexaverse_fallback_secure_cluster_key_2026".to_string());

    // 2. Extract headers
    let Some(sig_val) = req.headers().get("X-Internal-Signature") else {
        return Err(HttpResponse::Unauthorized().body("Missing X-Internal-Signature"));
    };
    let Some(ts_val) = req.headers().get("X-Internal-Timestamp") else {
        return Err(HttpResponse::Unauthorized().body("Missing X-Internal-Timestamp"));
    };
    let user_id_val = req.headers().get("X-User-Id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or(""); // Default to empty string if missing

    let Ok(sig_str) = sig_val.to_str() else {
        return Err(HttpResponse::Unauthorized().body("Invalid X-Internal-Signature encoding"));
    };
    let Ok(ts_str) = ts_val.to_str() else {
        return Err(HttpResponse::Unauthorized().body("Invalid X-Internal-Timestamp encoding"));
    };

    // 3. Parse timestamp to Unix time
    let Ok(incoming_ts) = ts_str.parse::<u64>() else {
        return Err(HttpResponse::Unauthorized().body("Invalid timestamp format"));
    };

    // 4. Compare with current time for drift check (replay protection)
    let current_time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let drift = if current_time >= incoming_ts {
        current_time - incoming_ts
    } else {
        incoming_ts - current_time
    };

    if drift > 5 {
        return Err(HttpResponse::Forbidden().body("Request timestamp expired or out of sync (replay attack protection)"));
    }

    // 5. Recompute HMAC-SHA256 signature
    // Format: "{timestamp}|{method}|{user_id}"
    let method = req.method().as_str();
    let message = format!("{}|{}|{}", ts_str, method, user_id_val);

    let Ok(sig_bytes) = hex::decode(sig_str) else {
        return Err(HttpResponse::Forbidden().body("Invalid signature hex encoding"));
    };

    let Ok(mut mac) = HmacSha256::new_from_slice(secret_key.as_bytes()) else {
        return Err(HttpResponse::InternalServerError().body("Failed to initialize HMAC key"));
    };
    mac.update(message.as_bytes());

    // 6. Perform a constant-time comparison
    if mac.verify_slice(&sig_bytes).is_err() {
        return Err(HttpResponse::Forbidden().body("Signature mismatch"));
    }

    Ok(())
}
