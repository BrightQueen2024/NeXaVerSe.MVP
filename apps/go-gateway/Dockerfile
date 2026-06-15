# Stage 1: Build the Go Gateway
FROM golang:1.22-alpine AS go-builder
WORKDIR /go-gateway

# Install git and certificates
RUN apk add --no-cache git ca-certificates

# Copy go.mod and go.sum and download dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy gateway source code
COPY . ./

# Build the binary with optimizations (disable CGO, compile for Linux, restrict compilation jobs)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -p 1 -ldflags="-w -s" -o go-gateway cmd/main.go

# Stage 2: Final light stage
FROM alpine:latest

WORKDIR /app

# Copy binary and certificates
COPY --from=go-builder /go-gateway/go-gateway .
COPY --from=go-builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

EXPOSE 8080

ENTRYPOINT ["./go-gateway"]
