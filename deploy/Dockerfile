# Build: docker build -f deploy/Dockerfile -t financer-server .
FROM rust:1-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo build --release -p financer-server

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --create-home financer \
 && mkdir /data && chown financer /data
COPY --from=build /src/target/release/financer-server /usr/local/bin/financer-server
USER financer
ENV FINANCER_BIND=0.0.0.0:8080 \
    FINANCER_DATABASE_URL=sqlite:///data/financer.db?mode=rwc
VOLUME /data
EXPOSE 8080
CMD ["financer-server"]
