# NeXaVerSe Cloud Deployment Manual (Render Hobby Free Tier)

This guide details how to configure the external cloud databases and deploy the NeXaVerSe microservices on the Render cloud hosting platform using the `render.yaml` Blueprint definition.

---

## Step 1: Set Up Cloud Databases (Free Tier)

To support the Public Alpha Test phase within free parameters, set up the following external cloud resources:

### A. Managed PostgreSQL (Neon or Supabase)
1. Sign up for a free tier at [Neon.tech](https://neon.tech/) or [Supabase.com](https://supabase.com/).
2. Create a new project named `nexaverse`.
3. Retrieve the database connection string. Make sure to toggle **connection pooling** on if supported (usually ports `5432` or `6543`) to prevent socket exhaustion.
4. Keep the connection string handy (e.g., `postgresql://user:password@ep-host.us-east-2.aws.neon.tech/neondb?sslmode=require`).

### B. MongoDB Document Storage (MongoDB Atlas)
1. Sign up for a free account at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
2. Create a new shared cluster using the **M0 Sandbox** tier (forever free).
3. Create a database user and password (e.g., `nexa-user`).
4. Go to **Network Access** and add a firewall rule. For Render services, you can whitelist all IPs (`0.0.0.0/0`) or find Render's static IP ranges if you use a paid egress proxy.
5. Under **Database > Connect**, copy the driver connection string (e.g., `mongodb+srv://user:pass@cluster.mongodb.net/nexaverse?retryWrites=true&w=majority`).

### C. Serverless Redis Presence Cache (Upstash)
1. Sign up at [Upstash.com](https://upstash.com/).
2. Create a Serverless Redis database in the same AWS region as your Render services (e.g., `us-east-1` or `eu-central-1`) to minimize latency.
3. Retrieve the Redis URL string (e.g., `redis://default:password@your-upstash-redis.upstash.io:6379`).

### D. Ethereum Testnet Node (Alchemy or Infura)
1. Sign up for a free developer account at [Alchemy.com](https://www.alchemy.com/) or [Infura.io](https://infura.io/).
2. Create an API Key for the **Ethereum Sepolia Testnet**.
3. Copy the HTTPS RPC URL (e.g., `https://eth-sepolia.g.alchemy.com/v2/your-api-key`).

---

## Step 2: Deploying to Render via Blueprints

Render's Blueprints feature allows you to orchestrate multiple services simultaneously by reading the `render.yaml` file in your repository.

1. **Push Code to GitHub:**
   Commit all changes and push your workspace repository to a private or public GitHub repository.

2. **Log into Render:**
   Navigate to the [Render Dashboard](https://dashboard.render.com/) and authorize connection to your GitHub account.

3. **Navigate to Blueprints:**
   * Click the **Blueprints** tab on the top navigation bar.
   * Click **New Blueprint Instance**.

4. **Connect your Repository:**
   * Find and select your NeXaVerSe repository in the list.
   * Enter a Group Name (e.g., `nexaverse-alpha-test`).
   * Select the Git branch to build (typically `main`).

5. **Provide Environment Variables:**
   Render will automatically parse the `render.yaml` file and prompt you to input the connection keys you retrieved in Step 1:
   * `DATABASE_URL` (Neon / Supabase connection)
   * `REDIS_URL` (Upstash connection)
   * `MONGODB_URI` (MongoDB Atlas connection)
   * `RPC_PROVIDER_URL` (Alchemy Sepolia RPC endpoint)

6. **Click Apply:**
   Render will initialize all three web services:
   * `nexa-go-gateway` (listening on port 8080)
   * `nexa-rust-ledger` (listening on port 8081)
   * `nexa-nestjs-media` (listening on port 8082)

---

## Memory & Resource Optimizations (Render Compliance)

To fit all microservices inside Render's **Free Hobby Tier (512MB RAM limitation)** and avoid Out-Of-Memory (OOM) build failures:
* **Go Compiler Optimization:** The Go build command uses `-p 1` to serialize compilation runs and prevent CPU/RAM overhead on the build node.
* **Rust Cargo Optimization:** The Rust ledger Dockerfile compiles dependencies and binaries with `--jobs 1`. This instructs cargo to build files sequentially using minimal RAM.
* **NestJS/Node.js Optimization:** The NestJS media processor uses `NODE_OPTIONS="--max-old-space-size=450"` during package installation and production builds. This lowers the Node garbage collector limit, keeping the system footprint well below 512MB.
* **Continuous Integration:** Render hooks up standard GitHub Webhooks. Any future push to your repository's branch will trigger an automated rolling zero-downtime rebuild and deploy.
