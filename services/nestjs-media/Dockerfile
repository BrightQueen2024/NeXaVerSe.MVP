# Step 1: Development & Build Stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files from the current isolated directory
COPY package*.json ./

# Install ALL dependencies (including devDependencies like typescript)
RUN npm ci

# Copy the rest of the microservice source code
COPY . .

# Compile TypeScript to production JavaScript
RUN npm run build

# Step 2: Clean Production Runtime Stage
FROM node:18-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy package files again for production installs
COPY package*.json ./

# Install ONLY production dependencies to keep the image tiny
RUN npm ci --only=production

# Copy the compiled dist folder from the builder stage
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main.js"]
