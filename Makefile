# Pantry: one local app. No server, no token, no client SDK.
SHELL := /bin/sh
.DEFAULT_GOAL := help

APP        := apps/mobile
NPM_STAMP  := $(APP)/node_modules/.package-lock.json

.PHONY: help doctor setup core-test core-build start web web-build typecheck test ui-icons ui-test ui-catalog ui-catalog-export clean

help: ## Show this list
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[1m%-13s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

doctor: ## Check which tools are installed
	@for t in node npm; do \
	  if command -v $$t >/dev/null 2>&1; then printf "  ok       %s\n" "$$t"; else printf "  MISSING  %s\n" "$$t"; fi; \
	done

core-test: ## Rust business-logic tests
	cargo test -p pantry-core

core-build: ## Rebuild the WebAssembly core used by Expo
	wasm-pack build crates/pantry-core --target web --out-dir ../../apps/mobile/src/rust --out-name pantry --release
	rm -f $(APP)/src/rust/.gitignore
	cd $(APP) && node -e 'const f=require("fs");const b=f.readFileSync("src/rust/pantry_bg.wasm").toString("base64");f.writeFileSync("src/rust/wasmBytes.ts","// Generated from pantry_bg.wasm. Do not edit.\nexport const WASM_BASE64 = \""+b+"\";\n")'

setup: $(NPM_STAMP) ## Install the app's packages (once)
	ln -sfn ../../apps/mobile/node_modules packages/finance-ui/node_modules

$(NPM_STAMP): $(APP)/package.json $(APP)/package-lock.json
	cd $(APP) && npm install

start: $(NPM_STAMP) ## Run the app locally (Expo)
	cd $(APP) && npm start

web: $(NPM_STAMP) ## Run the local app in the browser
	cd $(APP) && npm run web

web-build: $(NPM_STAMP) ## Static local web build into apps/mobile/dist
	cd $(APP) && npx expo export --platform web --output-dir dist

typecheck: $(NPM_STAMP) ## TypeScript check
	cd $(APP) && npm run typecheck

test: $(NPM_STAMP) ## Local logic tests
	cd $(APP) && npm test

ui-icons: ## Regenerate packages/ui/src/constants/medusaIcons.ts from docs/medusa (Rust converter, crates/uiconv)
	cd crates/uiconv && cargo run --release -- icons ../../docs/medusa/packages/design-system/icons/src ../../packages/ui/src/constants/medusaIcons.ts

ui-test: ## UI package token and contrast tests
	cd packages/ui && npm ci && npm test

ui-catalog: ## Design system catalog in the browser
	cd apps/catalog && npm ci && npx expo start --web

ui-catalog-export: ## Static catalog build
	cd apps/catalog && npm ci && npm run typecheck && npx expo export --platform web --output-dir dist

clean: ## Remove build output
	rm -rf $(APP)/dist $(APP)/.test-build
