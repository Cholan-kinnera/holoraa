# Holoraa v2 developer entry point. Run from the repository root.
#
# Toolchain: GO must be exactly $(GO_REQUIRED) (Go 1.27.3). Every target that
# compiles or checks Go code verifies this first. GOTOOLCHAIN=local stops Go
# from downloading a different toolchain. gofmt is taken from the same GOROOT
# as GO, so formatting and compilation always use one toolchain.
#
# Version: VERSION is injected into the binary at link time. The default is
# 0.0.0-dev. Override it on the command line, for example:
#     make build VERSION=1.2.3
# VERSION must start with a letter or digit and may contain only letters,
# digits, '.', '_', '+' and '-'. Any other value fails before anything is built.

GO          ?= go
GO_REQUIRED := go1.27.3
GOTOOLCHAIN ?= local
export GOTOOLCHAIN
GOFMT       ?= $(shell $(GO) env GOROOT)/bin/gofmt

VERSION ?= 0.0.0-dev
# RAW_VERSION is the value exactly as given. Make expands $-references in
# VERSION itself, so validation must look at the raw text, not at VERSION.
RAW_VERSION := $(value VERSION)
export RAW_VERSION
export VERSION
MODULE  := github.com/Cholan-kinnera/holoraa/backend
LDFLAGS := -X $(MODULE)/internal/version.Version=$(VERSION)

.PHONY: check toolchain-check validate-version fmt-check vet test build clean dev-env db-up db-down db-status migrate-up migrate-down migrate-status test-db web-install web-check contract-check check-all

check: toolchain-check validate-version fmt-check vet test build
	./bin/api -version

toolchain-check:
	@v="$$($(GO) env GOVERSION)" && [ "$$v" = "$(GO_REQUIRED)" ] || { echo "need $(GO_REQUIRED) as GO, found '$$v' from GO=$(GO)"; exit 1; }

validate-version:
	@printf '%s' "$$RAW_VERSION" | grep -E -q '^[A-Za-z0-9][A-Za-z0-9._+-]*$$' || { echo "invalid VERSION '$$RAW_VERSION': must start with a letter or digit and contain only letters, digits, . _ + -"; exit 1; }

fmt-check: toolchain-check
	@cd backend && out="$$($(GOFMT) -l . 2>&1)" || { echo "gofmt failed:"; echo "$$out"; exit 1; }; \
	if [ -n "$$out" ]; then echo "gofmt needs changes in:"; echo "$$out"; exit 1; fi

vet: toolchain-check
	cd backend && $(GO) vet ./...

test: toolchain-check
	cd backend && $(GO) test -race -count=1 ./...

build: toolchain-check validate-version
	mkdir -p bin
	cd backend && $(GO) build -ldflags "$(LDFLAGS)" -o ../bin/api ./cmd/api

clean:
	rm -rf bin

# Local development database (PostgreSQL only). See docs/engineering/LOCAL_SETUP.md.
# The compose file reads variables from .env in the repository root, so
# --env-file is passed explicitly. The container and volume names are v2-specific.
COMPOSE := docker compose --env-file .env -f infra/compose/docker-compose.yml

dev-env:
	scripts/dev-env.sh

db-up: dev-env
	$(COMPOSE) up -d --wait

# Stops the container. The data volume is kept. Never add -v here.
db-down:
	$(COMPOSE) down

db-status:
	$(COMPOSE) ps

# Migrations run through the API binary, reading HOLORAA_DATABASE_URL from .env.
migrate-up: db-up
	@set -a && . ./.env && set +a && cd backend && $(GO) run ./cmd/api migrate up

migrate-down: db-up
	@set -a && . ./.env && set +a && cd backend && $(GO) run ./cmd/api migrate down

migrate-status: db-up
	@set -a && . ./.env && set +a && cd backend && $(GO) run ./cmd/api migrate status

# All Go tests, including the tests that need PostgreSQL. The integration tests
# create and drop their own scratch databases on the development server.
test-db: toolchain-check db-up
	@set -a && . ./.env && set +a && export HOLORAA_TEST_DATABASE_URL="$$HOLORAA_DATABASE_URL" && cd backend && $(GO) test -race -count=1 ./...

# Web app and contract. Installs from the committed lockfile only (npm ci).
web-install:
	cd web && npm ci

web-check: web-install
	cd web && npm run -s typecheck && npm run -s lint && npm run -s test && npm run -s build

# The contract must lint, and regenerating the client must produce no diff.
contract-check: web-install
	cd web && npm run -s lint:contract
	@tmp=$$(mktemp) && cd web && npx openapi-typescript ../contracts/openapi.yaml -o "$$tmp" && cmp -s "$$tmp" src/lib/api/schema.ts; rc=$$?; rm -f "$$tmp"; if [ $$rc -ne 0 ]; then echo "generated client is out of date: run npm run gen:api in web/ and commit the result"; fi; exit $$rc

# Everything: Go gate, database-backed Go tests, web, and contract.
check-all: check test-db web-check contract-check
