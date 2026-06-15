# Step 1: Planning and dependency caching stage
FROM rust:1.85-slim AS builder

WORKDIR /usr/src/app

# Install system dependencies required for compiling crypto/ledger tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy the source code
COPY . .

# Build the release binary
RUN cargo build --release

# Step 2: Ultra-lightweight runtime container
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime security packages (like SSL certificates for blockchain calls)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Copy the compiled binary from the builder stage
COPY --from=builder /usr/src/app/target/release/rust-ledger ./rust-ledger

EXPOSE 8080

CMD ["./rust-ledger"]
