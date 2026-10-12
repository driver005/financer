# Developer shortcuts. Run `make` (or `make help`) for the list.
#
#   make setup      install the app's npm packages (once)
#   make dev        Rust server + hot-reloading web app together, with a dev token
#   make server     only the Rust server          make web      only the web app
#   make app        Expo for a phone (Expo Go)    make serve    built web app served by the server
#
# Everything local lives in .dev/ (ignored by version control): the SQLite file, the dev token, the
# server's config file .dev/financer.toml (made from financer.example.toml by `make dev`; see
# docs/CONFIG.md) and an optional .dev/env file for your own FINANCER_* settings (API keys, ...).

SHELL := /bin/sh
.DEFAULT_GOAL := help

DEV_DIR   := .dev
MOBILE    := apps/mobile
BIND      ?= 127.0.0.1:8080
WEB_PORT  ?= 8081
RUST_LOG  ?= info,tower_http=warn
DB_URL    ?= $(or $(FINANCER_DATABASE_URL),sqlite://$(CURDIR)/$(DEV_DIR)/financer.db?mode=rwc)
PG_URL    := postgres://financer:financer@127.0.0.1:5432/financer
COMPOSE   := docker compose -f deploy/docker-compose.dev.yml

# Environment for the server. .dev/env (if it exists) is loaded first, so values given on the
# command line or set below win over it. .dev/financer.toml is used when it exists (unless
# FINANCER_CONFIG already names another file); the variables below win over what it says.
SERVER_ENV = set -a; [ -f $(DEV_DIR)/env ] && . ./$(DEV_DIR)/env; set +a; \
	if [ -f $(DEV_DIR)/financer.toml ]; then export FINANCER_CONFIG="$${FINANCER_CONFIG:-$(CURDIR)/$(DEV_DIR)/financer.toml}"; fi; \
	export FINANCER_API_TOKEN="$$(cat $(DEV_DIR)/token)" FINANCER_DATABASE_URL="$(DB_URL)" \
	FINANCER_BIND="$(BIND)" RUST_LOG="$(RUST_LOG)" \
	FINANCER_CORS_ORIGIN="http://localhost:$(WEB_PORT),http://127.0.0.1:$(WEB_PORT)"

# Written by npm when it installs; newer than package-lock.json means the packages are current.
NPM_STAMP := $(MOBILE)/node_modules/.package-lock.json

API_HOST := $(firstword $(subst :, ,$(BIND)))
API_PORT := $(lastword $(subst :, ,$(BIND)))

.PHONY: help doctor setup token info check-port stop dev dev-postgres server server-watch web app android ios \
        web-build serve db-up db-down db-reset dev-reset gen-api test lint fmt check clean

help: ## Show this list
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[1m%-13s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo
	@echo "Options (VAR=value): BIND=$(BIND)  WEB_PORT=$(WEB_PORT)  DB_URL=<sqlite or postgres url>"

doctor: ## Check which tools are installed
	@for t in cargo node npm; do \
	  if command -v $$t >/dev/null 2>&1; then printf "  ok       %s\n" "$$t"; else printf "  MISSING  %s (required)\n" "$$t"; fi; \
	done
	@for t in cargo-watch docker; do \
	  if command -v $$t >/dev/null 2>&1; then printf "  ok       %s\n" "$$t"; else printf "  missing  %s (optional: %s)\n" "$$t" \
	  "$$( [ $$t = cargo-watch ] && echo 'restarts the server when Rust code changes: cargo install cargo-watch' || echo 'needed only for make dev-postgres')"; fi; \
	done

setup: $(NPM_STAMP) ## Install the app's npm packages

$(NPM_STAMP): $(MOBILE)/package-lock.json
	cd $(MOBILE) && npm ci

$(DEV_DIR)/token:
	@mkdir -p $(DEV_DIR)
	@od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > $@
	@chmod 600 $@
	@echo "created a dev token in $@"

token: $(DEV_DIR)/token ## Print the dev token (paste it into the app under Settings)
	@cat $(DEV_DIR)/token; echo

info: $(DEV_DIR)/token ## Show the URLs and the token
	@echo "  API         http://$(BIND)   (health: http://$(BIND)/health)"
	@echo "  Web app     http://localhost:$(WEB_PORT)   (make web / make dev)"
	@echo "  Database    $(DB_URL)"
	@if [ -f $(DEV_DIR)/financer.toml ]; then echo "  Config      $(DEV_DIR)/financer.toml (the settings above win over it)"; fi
	@echo "  Token       $$(cat $(DEV_DIR)/token)"
	@echo "  In the app: Settings > Server, URL http://localhost:$(lastword $(subst :, ,$(BIND))), paste the token."
	@echo "  A phone needs your computer's address instead of localhost: make dev BIND=0.0.0.0:8080"

check-port: ## Fail early, with advice, if the server's port is already taken
	@node -e 'const s=require("net").createServer();s.on("error",()=>process.exit(1));s.listen(+process.argv[2],process.argv[1],()=>s.close())' $(API_HOST) $(API_PORT) || { \
	  echo; \
	  echo "Port $(API_PORT) on $(API_HOST) is already in use, so the server cannot start."; \
	  echo "Most likely another 'make dev', 'make server' or 'make serve' is still running (in another terminal?)."; \
	  (ss -ltnp 2>/dev/null | grep ":$(API_PORT) " || lsof -nP -iTCP:$(API_PORT) -sTCP:LISTEN 2>/dev/null) | sed 's/^/  /'; \
	  echo "Fix it with one of:"; \
	  echo "  make stop                          stop a leftover Financer server"; \
	  echo "  make $(if $(filter-out check-port stop,$(firstword $(MAKECMDGOALS))),$(firstword $(MAKECMDGOALS)),dev) BIND=$(API_HOST):8090      use another port"; \
	  echo; exit 1; }

stop: ## Stop a leftover Financer server (the cargo-run one from make dev / server / serve)
	@if pkill -x financer-server; then echo "stopped financer-server"; else echo "no financer-server is running"; fi

$(DEV_DIR)/financer.toml:
	@mkdir -p $(DEV_DIR)
	@cp financer.example.toml $@
	@chmod 600 $@
	@echo "created $@ from financer.example.toml (everything in it is commented out)"

dev: check-port $(DEV_DIR)/token $(DEV_DIR)/financer.toml $(NPM_STAMP) ## Server (restarts on changes) + web app together; Ctrl-C stops both
	@$(MAKE) --no-print-directory info
	@trap 'kill 0' INT TERM; \
	  $(MAKE) --no-print-directory server-watch & \
	  $(MAKE) --no-print-directory web & \
	  wait

dev-postgres: db-up ## Same as dev, but on a PostgreSQL container (needs Docker)
	@$(MAKE) --no-print-directory dev DB_URL="$(PG_URL)"

server: check-port $(DEV_DIR)/token ## Run the Rust server once
	@$(SERVER_ENV); exec cargo run -p financer-server

server-watch: check-port $(DEV_DIR)/token ## Run the Rust server and restart it when the Rust code changes
	@if command -v cargo-watch >/dev/null 2>&1; then \
	  $(SERVER_ENV); exec cargo watch -q -w crates -w Cargo.toml -x 'run -p financer-server'; \
	else \
	  echo "cargo-watch is not installed, so the server will not restart on changes (cargo install cargo-watch)"; \
	  $(SERVER_ENV); exec cargo run -p financer-server; \
	fi

web: $(NPM_STAMP) ## Expo web app with hot reload (needs the server: make server)
	cd $(MOBILE) && npx expo start --web --port $(WEB_PORT)

app: $(NPM_STAMP) ## Expo for a phone or emulator (scan the QR code with Expo Go)
	cd $(MOBILE) && npx expo start

android: $(NPM_STAMP) ## Expo on an Android emulator or device
	cd $(MOBILE) && npx expo start --android

ios: $(NPM_STAMP) ## Expo on an iOS Simulator (macOS only)
	cd $(MOBILE) && npx expo start --ios

web-build: $(NPM_STAMP) ## Build the web app into apps/mobile/dist
	cd $(MOBILE) && npx expo export --platform web --output-dir dist

serve: check-port web-build $(DEV_DIR)/token ## Server plus the built web app on one address, like a release
	@$(SERVER_ENV); unset FINANCER_CORS_ORIGIN; FINANCER_WEB_DIR="$(CURDIR)/$(MOBILE)/dist" exec cargo run -p financer-server

db-up: ## Start the dev PostgreSQL container (127.0.0.1:5432)
	$(COMPOSE) up -d --wait postgres

db-down: ## Stop the dev PostgreSQL container (keeps its data)
	$(COMPOSE) down

db-reset: ## Delete the dev PostgreSQL data
	$(COMPOSE) down -v

dev-reset: ## Delete the dev SQLite database (keeps the token and .dev/env)
	rm -f $(DEV_DIR)/financer.db $(DEV_DIR)/financer.db-shm $(DEV_DIR)/financer.db-wal

gen-api: $(NPM_STAMP) ## Regenerate openapi.json and the app's API types
	cd $(MOBILE) && npm run gen:api

test: $(NPM_STAMP) ## Rust and app tests
	cargo test --workspace
	cd $(MOBILE) && npm test

lint: $(NPM_STAMP) ## Formatting, clippy and the TypeScript check
	cargo fmt --check
	cargo clippy --workspace --all-targets -- -D warnings
	cd $(MOBILE) && npx tsc --noEmit

fmt: ## Format the Rust code
	cargo fmt

check: lint test ## Everything CI checks, locally

clean: ## Remove build output (Rust target/, the web build) but keep .dev/
	cargo clean
	rm -rf $(MOBILE)/dist $(MOBILE)/.test-build
