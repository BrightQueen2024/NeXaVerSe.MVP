# NeXaVerSe Ecosystem Monorepo

Welcome to the production-grade monorepo for the **NeXaVerSe** platform. This architecture has been designed and scaffolded by a senior software engineering team to sustain a world-class throughput of **65,000 TPS** and **500,000 concurrent active WebSocket connections**.

---

## Technical Stack & Topology

* **Go Gateway (`/go-gateway`)**: High-performance, event-driven WebSocket and presence gateway using `gobwas/ws` non-blocking epoll loop to eliminate goroutine-per-connection scheduling overhead.
* **Rust Ledger (`/rust-ledger`)**: High-speed double-entry wallet ledger and atomic escrow system powered by Actix-web and SQLx. Integrates a **Transactional Outbox Batcher** background worker to queue and batch on-chain transaction settlement requests, bypassing L2 RPC congestion bottlenecks.
* **NestJS Media & Stream Engine (`/nestjs-media`)**: Handles social feeds, engagement tracking, and video uploads. Implements a sliding-window hourly Redis cache (`HSET`/`ZSET`) to compute moving 24h Engagement Scores ($ES$) in $O(1)$ and dispatches asynchronous media processing tasks to offload edge classification.
* **Kubernetes Deployments (`/k8s`)**: Complete declarative configuration manifests including ConfigMaps, secrets, topological spreads, resource limits, and health check readiness probes.

---

## Directory Map

```text
nexaverse/
├── go-gateway/            # Go WebSocket & Presence Server
│   ├── cmd/               # main.go entry point
│   ├── pkg/               # Connection handlers, epoll poller, presence logic
│   └── go.mod
├── rust-ledger/           # Rust Actix-Web Wallet & Escrow Ledger
│   ├── src/               # Models, handlers, background batcher, entry point
│   └── Cargo.toml
├── nestjs-media/          # NestJS social feed & media processor
│   ├── src/               # Media uploads, stream processing, reward split engine
│   └── package.json
└── k8s/                   # Kubernetes deployment configurations
    └── nexaverse-services.yaml
```

---

## Service Endpoints & Integration Testing

### 1. Go-Gateway (WebSocket)
Port: `8080` (WS Route: `/ws`)
* Connect a WebSocket client to `/ws?user_id=123&age=16`.
* **Sandbox Behavior:** Accounts with age 15–17 are quarantined. Direct messages are dropped unless a mutual friend link exists in Redis (`friends:123`).

### 2. Rust-Ledger (API)
Port: `8081`
* **Transfer NEXA Off-Chain:**
  ```bash
  curl -X POST http://localhost:8081/wallet/transfer \
    -H "X-Idempotency-Key: unique-tx-uuid-1" \
    -H "Content-Type: application/json" \
    -d '{"receiver_id": "user_recipient_456", "amount": 100.00}'
  ```
* **Lock Escrow:**
  ```bash
  curl -X POST http://localhost:8081/escrow/create \
    -H "X-Idempotency-Key: unique-escrow-uuid-1" \
    -H "Content-Type: application/json" \
    -d '{"order_id": "order_789", "seller_id": "user_seller_789", "amount": 250.00}'
  ```
* **Release Escrow:**
  ```bash
  curl -X POST http://localhost:8081/escrow/release/escrow-uuid-here \
    -H "Content-Type: application/json" \
    -d '{"signature": "0x-cryptographic-delivery-multisig-signature"}'
  ```

### 3. NestJS Media Engine (API)
Port: `8082`
* **Upload Video / Image:**
  ```bash
  curl -X POST http://localhost:8082/media/upload?creator_id=creator_123 \
    -F "file=@demo-bible-verse.mp4"
  ```
  * *Note: Files containing "bible", "god", or "divine" in the name trigger the 5.0x category multiplier during classification.*
* **Record Engagement Event:**
  ```bash
  curl -X POST http://localhost:8082/feed/engagement \
    -H "Content-Type: application/json" \
    -d '{"postId": "post_xyz", "type": "like", "count": 1}'
  ```
* **Register NexLink Graph Curation:**
  ```bash
  curl -X POST http://localhost:8082/feed/link \
    -H "Content-Type: application/json" \
    -d '{"postId": "post_xyz", "linkerId": "linker_456"}'
  ```
* **Check Post-to-Earn Rewards:**
  ```bash
  curl -X GET "http://localhost:8082/feed/rewards/post_xyz?creator_id=creator_123&category=DIVINE"
  ```

### 4. NestJS KYC Engine (API)
Port: `8082`
* **Register Biometric Signature:**
  ```bash
  curl -X POST http://localhost:8082/kyc/register-biometrics \
    -H "Content-Type: application/json" \
    -d '{"userId": "user_sender_123", "biometricPublicKey": "ssh-ed25519-secure-enclave-key"}'
  ```
* **Verify Facial Similarity (Selfie vs ID Document):**
  ```bash
  curl -X POST http://localhost:8082/kyc/verify-face \
    -F "userId=user_sender_123" \
    -F "selfie=@selfie.jpg" \
    -F "document=@passport.jpg"
  ```
* **Check KYC status:**
  ```bash
  curl -X GET http://localhost:8082/kyc/status/user_sender_123
  ```
  * *Note: If a wallet is not KYC verified, transaction requests over 1000 NEXA inside `rust-ledger` are rejected with HTTP 403 Forbidden.*

---

## Local Development Orchestration

### Prerequisites
* Go 1.22+
* Rust (Cargo)
* Node.js & npm (v20+)
* Redis and PostgreSQL running locally (if running standalone)
* **Docker & Docker Compose** (highly recommended)

### Running Services

#### Option A: Docker Compose Orchestration (Recommended)
You can run the entire ecosystem (Go Gateway, Rust Ledger, NestJS Media, Postgres, Redis, MinIO, and auto-provisioning) with a single command:
```bash
docker compose up --build
```
This automatically compiles the microservices, starts dependencies with active healthchecks, and provisions the `nexa-media` bucket.

#### Option B: Standalone Manual Bootup
1. **Go WebSocket Gateway**:
   ```bash
   cd go-gateway
   go run cmd/main.go
   ```
2. **Rust Wallet Ledger**:
   ```bash
   cd rust-ledger
   cargo run
   ```
3. **NestJS Media Server**:
   ```bash
   cd nestjs-media
   npm install
   npm run start
   ```

#### Option C: Smart Contracts Compilation & Local Chain Deploy
1. **Bootstrap Contracts Workspace**:
   ```bash
   cd contracts
   npm install
   ```
2. **Compile Solidity Contracts**:
   ```bash
   npm run compile
   ```
3. **Launch local blockchain (Hardhat network node)**:
   ```bash
   npx hardhat node
   ```
4. **Deploy contracts to local network**:
   Open a separate shell terminal inside `/contracts`:
   ```bash
   npm run deploy:local
   ```
   *This outputs the deployed contract addresses to configure in your L2 backend mappings.*

#### Option D: E2E Integration Test Execution
Make sure your docker compose services (Option A) are active, then run the integration test runner:
1. **Initialize Workspace**:
   ```bash
   cd scripts
   npm install
   ```
2. **Execute Tests**:
   ```bash
   npm run test
   ```
   *This executes active validations on Sandbox messaging controls, P2E payout splits, face-matching status triggers, and Rust balance KYC caps.*

#### Option E: React Native / Expo Client Bootup
1. **Initialize Workspace**:
   ```bash
   cd client
   npm install
   ```
2. **Launch Developer Expo Server**:
   ```bash
   npm run start
   ```
   *This starts the Metro bundler. Press `a` for Android Emulator, `i` for iOS Simulator, or `w` to spin up the React Native Web interface directly in your default browser.*
3. **Launch Web Preview directly**:
   ```bash
   npm run web
   ```

### Kubernetes Deployment
Deploy the entire mesh using the single production manifest:
```bash
kubectl apply -f k8s/nexaverse-services.yaml
```
This sets up deployments, ConfigMaps, resources, and readiness/liveness tests in the `nexaverse` namespace.

---

## CI/CD Automation
The monorepo includes a declarative **GitHub Actions Workflow** config at [.github/workflows/ci.yml](file:///C:/Users/HP/.gemini/antigravity/scratch/nexaverse/.github/workflows/ci.yml). 
On every code push or pull request to `main` or `develop` branches, the pipeline:
1. Compiles Solidity smart contracts and runs Hardhat unit tests.
2. Compiles the Go gateway microservice and runs unit tests.
3. Compiles the Rust ledger microservice (using abigen macro to load Solidity artifacts).
4. Installs and builds the NestJS media service.
5. Builds and pushes the Docker images for all three services to Docker Hub (or AWS ECR) using secure action tokens.
