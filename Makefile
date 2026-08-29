# OBD Telemetry — developer commands.
#
# Run from the repo root. The `build` target is the one to use
# for production deploys; it bakes the build identity (git SHA
# + timestamp + SERVICE_VERSION) into the images, which the
# /healthz endpoint then surfaces.

SERVICE_VERSION ?= 1.1.0
BUILD_COMMIT    ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
BUILD_TIME      ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)

SERVER_IMAGE    ?= obd-telemetry-server
DASH_IMAGE      ?= obd-telemetry-dashboard

.PHONY: help build build-server build-dashboard version test test-server lint lint-fix clean

help:
	@echo "OBD Telemetry — make targets"
	@echo
	@echo "  make version         print the build identity that will be baked in"
	@echo "  make build           build both images (server + dashboard) with build identity"
	@echo "  make build-server    build only the server image"
	@echo "  make build-dashboard build only the dashboard image"
	@echo "  make test            run server jest tests"
	@echo "  make lint            (placeholder)"

version:
	@echo "SERVICE_VERSION = $(SERVICE_VERSION)"
	@echo "BUILD_COMMIT    = $(BUILD_COMMIT)"
	@echo "BUILD_TIME      = $(BUILD_TIME)"

build: build-server build-dashboard

build-server:
	podman build \
		--build-arg SERVICE_VERSION=$(SERVICE_VERSION) \
		--build-arg BUILD_COMMIT=$(BUILD_COMMIT) \
		--build-arg BUILD_TIME=$(BUILD_TIME) \
		-f Server/Dockerfile \
		-t $(SERVER_IMAGE):$(BUILD_COMMIT) \
		-t $(SERVER_IMAGE):latest \
		Server

build-dashboard:
	@if [ -z "$$NEXT_PUBLIC_API_URL" ]; then \
		echo "NOTE: NEXT_PUBLIC_API_URL is not set; using the .env value if present."; \
	fi
	podman build \
		--build-arg SERVICE_VERSION=$(SERVICE_VERSION) \
		--build-arg BUILD_COMMIT=$(BUILD_COMMIT) \
		--build-arg BUILD_TIME=$(BUILD_TIME) \
		--build-arg NEXT_PUBLIC_API_URL=$${NEXT_PUBLIC_API_URL:-https://obd-api.hon2838.name.my} \
		-f Dashboard/Dockerfile \
		-t $(DASH_IMAGE):$(BUILD_COMMIT) \
		-t $(DASH_IMAGE):latest \
		Dashboard

test: test-server

test-server:
	cd Server && ./node_modules/.bin/jest --no-coverage

clean:
	rm -rf Server/node_modules Dashboard/node_modules Dashboard/.next
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
