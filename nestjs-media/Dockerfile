# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package manifests
COPY package.json ./

# Install all dependencies (optimize for memory bounds)
RUN NODE_OPTIONS="--max-old-space-size=450" npm install --no-audit --no-fund

# Copy source and configurations
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

# Build production compiled JS code (garbage collect aggressively)
RUN NODE_OPTIONS="--max-old-space-size=450" npm run build

# Runner stage
FROM node:20-alpine

WORKDIR /app

# Copy package manifests and install only production dependencies
COPY package.json ./
RUN NODE_OPTIONS="--max-old-space-size=450" npm install --no-audit --no-fund --only=production

# Copy compiled code from builder stage
COPY --from=builder /app/dist ./dist

EXPOSE 8082

ENTRYPOINT ["node", "dist/main"]
