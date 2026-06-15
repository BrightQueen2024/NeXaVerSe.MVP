# Stage 1: Build the Expo Web Client
FROM node:18-alpine AS client-builder
WORKDIR /client

# Copy package files and install dependencies
COPY apps/client/package*.json ./
RUN npm install

# Pass the gateway URL from Render build environment to compile it in
ARG EXPO_PUBLIC_GATEWAY_URL
ENV EXPO_PUBLIC_GATEWAY_URL=$EXPO_PUBLIC_GATEWAY_URL

# Copy client source code
COPY apps/client/ ./

# Run expo export to generate the static files in /client/dist
RUN npx expo export --platform web

# Stage 2: Build the Go Gateway
FROM golang:1.22-alpine AS go-builder
WORKDIR /go-gateway

# Install git and certificates
RUN apk add --no-cache git ca-certificates

# Copy go.mod and go.sum and download dependencies
COPY apps/go-gateway/go.mod apps/go-gateway/go.sum ./
RUN go mod download

# Copy gateway source code
COPY apps/go-gateway/ ./

# Build the binary with optimizations (disable CGO, compile for Linux, restrict compilation jobs)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -p 1 -ldflags="-w -s" -o go-gateway cmd/main.go

# Stage 3: Final light stage
FROM alpine:latest

WORKDIR /app

# Copy binary and certificates
COPY --from=go-builder /go-gateway/go-gateway .
COPY --from=go-builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
# Copy the compiled client assets
COPY --from=client-builder /client/dist ./dist

EXPOSE 8080

ENTRYPOINT ["./go-gateway"]
