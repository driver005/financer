# Build: docker build -f deploy/Dockerfile -t financer-server .
# Behind Docker Hub rate limits: --build-arg REGISTRY=mirror.gcr.io/library/
# With the shopping assistant inside (docs/SHOP.md): --build-arg FEATURES=shop
ARG REGISTRY=docker.io/library/

FROM ${REGISTRY}rust:1-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
ARG FEATURES=""
RUN cargo build --release -p financer-server ${FEATURES:+--features "$FEATURES"}

ARG REGISTRY
FROM ${REGISTRY}debian:bookworm-slim
# CA certificates come from the build image, so this stage needs no apt (and no network).
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN useradd --system --uid 10001 --create-home financer \
 && mkdir /data && chown financer /data
COPY --from=build /src/target/release/financer-server /usr/local/bin/financer-server
USER financer
ENV FINANCER_BIND=0.0.0.0:8080 \
    FINANCER_DATABASE_URL=sqlite:///data/financer.db?mode=rwc \
    FINANCER_SETTINGS_FILE=/data/financer.settings.json
VOLUME /data
EXPOSE 8080
CMD ["financer-server"]
