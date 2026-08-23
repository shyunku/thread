FROM golang:1.19-alpine AS builder

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/memorial-app-server ./core

FROM alpine:3.20

RUN addgroup -S memorial && adduser -S memorial -G memorial
WORKDIR /app
COPY --from=builder /out/memorial-app-server ./memorial-app-server
USER memorial

EXPOSE 4033
CMD ["./memorial-app-server"]

