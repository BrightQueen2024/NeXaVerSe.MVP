# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Install git and certificates
RUN apk add --no-cache git ca-certificates

# Copy go.mod and go.sum (if exists) and download dependencies
COPY go.mod ./
RUN go mod download

# Copy source code
COPY . .

# Build the binary with optimizations (disable CGO, compile for Linux, restrict compilation jobs)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -p 1 -ldflags="-w -s" -o go-gateway cmd/main.go

# Final light stage
FROM alpine:latest

WORKDIR /app

# Copy binary and certificates
COPY --from=builder /app/go-gateway .
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

EXPOSE 8080

ENTRYPOINT ["./go-gateway"]
