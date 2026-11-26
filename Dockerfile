# Production image: the Rust server (server-rs) + the static client. The Node server in server/ is the reference
# implementation the Rust port is checked against; see Dockerfile.node for an image that runs it.
FROM rust:1-alpine AS build
RUN apk add --no-cache build-base
WORKDIR /src
COPY server-rs ./server-rs
RUN cd server-rs && cargo build --release --locked

FROM alpine:3.22
RUN addgroup -S -g 10001 horde && adduser -S -u 10001 -G horde horde
ENV PORT=8080 DATA_DIR=/data APP_ROOT=/app
WORKDIR /app
COPY --from=build /src/server-rs/target/release/horde-server /app/horde-server
COPY shared ./shared
COPY public ./public
RUN mkdir -p /data && chown horde:horde /data
USER horde
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
CMD ["/app/horde-server"]
