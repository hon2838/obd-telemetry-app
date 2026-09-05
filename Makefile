# OBD Telemetry — developer commands.
#
# Run from the repo root. The `build` target is the one to use
# for production deploys; it bakes the build identity (git SHA
# + timestamp + SERVICE_VERSION) into the images, which the
# /healthz endpoint then surfaces.

SERVICE_VERSION ?= 1.2.0
BUILD_COMMIT    ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
BUILD_TIME      ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)

SERVER_IMAGE    ?= obd-telemetry-server
DASH_IMAGE      ?= obd-telemetry-dashboard

.PHONY: help build build-server build-dashboard build-all apk apk-bundle version test test-server lint lint-fix clean

help:
	@echo "OBD Telemetry — make targets"
	@echo
	@echo "  make version         print the build identity that will be baked in"
	@echo "  make apk            build the Android APK from AndroidApp/"
	@echo "  make apk-bundle     stage the APK + version.json into Server/agent/ for Docker build"
	@echo "  make build          build both images (server + dashboard) with build identity"
	@echo "  make build-all      apk-bundle + build (the 'ship a release' target)"
	@echo "  make build-server   build only the server image"
	@echo "  make build-dashboard build only the dashboard image"
	@echo "  make test           run server jest tests"
	@echo "  make lint           (placeholder)"

version:
	@echo "SERVICE_VERSION = $(SERVICE_VERSION)"
	@echo "BUILD_COMMIT    = $(BUILD_COMMIT)"
	@echo "BUILD_TIME      = $(BUILD_TIME)"

# Build the Android APK. Requires ANDROID_HOME and a working
# Android SDK + JDK 17+. The output goes to
# AndroidApp/app/build/outputs/apk/debug/app-debug.apk.
# `make apk-bundle` then stages the file where the server
# Dockerfile expects it.
apk:
	cd AndroidApp && ANDROID_HOME=$${ANDROID_HOME:-$$HOME/Android/Sdk} \
	  ANDROID_SDK_ROOT=$${ANDROID_SDK_ROOT:-$$ANDROID_HOME} \
	  ./gradlew :app:assembleDebug --no-daemon

# Copy the freshly-built APK into Server/agent/ and write a
# version.json sidecar with the version code/name + SHA-256.
# The Server Dockerfile expects both files at this exact
# path; `make build-server` then bakes them into the image.
# Also stages static/install.sh into the build context so the
# server can serve it at /install.sh.
apk-bundle: apk
	@mkdir -p Server/agent
	@cp AndroidApp/app/build/outputs/apk/debug/app-debug.apk Server/agent/app-debug.apk
	@cp static/install.sh Server/install.sh
	@VERSION_CODE=$$(grep -oP 'versionCode\s*=\s*\K[0-9]+' AndroidApp/app/build.gradle.kts) && \
	  VERSION_NAME=$$(grep -oP 'versionName\s*=\s*"\K[^"]+' AndroidApp/app/build.gradle.kts) && \
	  SIZE=$$(stat -c%s Server/agent/app-debug.apk) && \
	  SHA=$$(sha256sum Server/agent/app-debug.apk | awk '{print $$1}') && \
	  printf '{\n  "versionCode": %s,\n  "versionName": "%s",\n  "size_bytes": %s,\n  "sha256": "%s",\n  "build_commit": "%s",\n  "build_time": "%s"\n}\n' \
	    "$$VERSION_CODE" "$$VERSION_NAME" "$$SIZE" "$$SHA" "$(BUILD_COMMIT)" "$(BUILD_TIME)" > Server/agent/version.json
	@echo "Staged APK: Server/agent/app-debug.apk ($$(stat -c%s Server/agent/app-debug.apk) bytes, v$$VERSION_NAME)"

build: build-server build-dashboard

build-all: apk-bundle build

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
	rm -rf Server/agent/app-debug.apk Server/agent/version.json
	rm -f Server/install.sh
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
