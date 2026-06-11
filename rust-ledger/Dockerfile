# Build stage
FROM rust:1.75-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y pkg-config libssl-dev ca-certificates & rm -rf /var/lib/apt/lists/*

# Copy manifests
COPY Cargo.toml ./

# Create dummy source file to compile dependencies first (Docker cache optimization)
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release --jobs 1
RUN rm -rf src

# Copy real source code
COPY src ./src
COPY contracts ./contracts

# Build the real binary
# Touch main.rs to force cargo to rebuild it
RUN touch src/main.rs && cargo build --release --jobs 1

# Runner stage
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies (OpenSSL certificates)
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy compiled binary from builder
COPY --from=builder /app/target/release/rust-ledger .

EXPOSE 8081

ENTRYPOINT ["./rust-ledger"]
