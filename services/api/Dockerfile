FROM golang:1.19-alpine AS builder

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/thread-api ./core

FROM alpine:3.20

RUN apk add --no-cache tzdata \
    && addgroup -S thread \
    && adduser -S thread -G thread
WORKDIR /app
COPY --from=builder /out/thread-api ./thread-api
USER thread

EXPOSE 4033
CMD ["./thread-api"]
