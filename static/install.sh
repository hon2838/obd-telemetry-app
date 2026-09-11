#!/bin/bash
# ==============================================================================
#  OBD Telemetry — One-Click Head Unit Installer
#
#  Usage:
#    curl -sSL https://obd-api.hon2838.name.my/install.sh | sudo bash -s -- [OPTIONS]
#
#  Options:
#    --api-url URL     The OBD server's public URL (e.g. https://obd-api.hon2838.name.my)
#                      Default: https://obd-api.hon2838.name.my
#    --api-key KEY     (Deprecated) Optional legacy API key.
#    --node-id ID      Override the auto-detected node id (defaults to hostname).
#    --force           Reinstall even if the same version is already installed.
#    --uninstall       Remove the app and disable the service.
#    --help            Show this message.
#
#  The script:
#    1. Queries /api/agent/latest on the server to find the
#       current version + APK SHA-256.
#    2. Downloads the APK and verifies the hash.
#    3. Installs it via `pm install` (preserves the user's
#       SharedPreferences, so the OBD-API-Key set in a prior
#       install is kept).
#    4. Reboots the foreground service so the new APK starts
#       with the user's existing config.
# ==============================================================================
set -euo pipefail

# ----- args --------------------------------------------------------------
API_URL="https://obd-api.hon2838.name.my"
API_KEY=""
NODE_ID=""
FORCE=0
UNINSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --api-url)  API_URL="$2"; shift 2 ;;
    --api-key)  API_KEY="$2"; shift 2 ;;
    --node-id)  NODE_ID="$2"; shift 2 ;;
    --force)    FORCE=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --help|-h)
      sed -n '3,28p' "$0"; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Always follow redirects. The Cloudflare-tunneled URL may
# 301 from http->https or apex->www; the script has to handle
# both transparently. The curl invocations below use
# `curl -fsSL --max-time ...` which includes the -L flag.

# ----- color output ------------------------------------------------------
COLOR_RED='\033[0;31m'
COLOR_GREEN='\033[0;32m'
COLOR_YELLOW='\033[1;33m'
COLOR_CYAN='\033[0;36m'
COLOR_RESET='\033[0m'

log()  { echo -e "${COLOR_CYAN}[install]${COLOR_RESET} $*"; }
ok()   { echo -e "${COLOR_GREEN}[ok]${COLOR_RESET} $*"; }
warn() { echo -e "${COLOR_YELLOW}[warn]${COLOR_RESET} $*"; }
err()  { echo -e "${COLOR_RED}[error]${COLOR_RESET} $*" >&2; }

# ----- root check --------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  err "Please run as root (e.g. with sudo)."
  exit 1
fi

# ----- uninstall path ----------------------------------------------------
if [ "$UNINSTALL" = "1" ]; then
  log "Uninstalling OBD Telemetry..."
  pm uninstall com.example.obdapp 2>/dev/null || true
  ok "Uninstalled."
  exit 0
fi

# ----- required tools ----------------------------------------------------
for cmd in curl sha256sum pm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "Required command not found: $cmd"
    exit 1
  fi
done

# Note: In previous versions, --api-key was required on CLI. Authentication
# is now securely managed via in-app device pairing (/pair) or app settings.
if [ -n "$API_KEY" ]; then
  warn "Passing --api-key via CLI is deprecated. Pair the device securely from the OBD app interface."
fi

# ----- auto-detect node id ----------------------------------------------
if [ -z "$NODE_ID" ]; then
  NODE_ID="$(getprop ro.product.model 2>/dev/null || hostname 2>/dev/null || echo android)"
  # Normalize: lowercase, replace whitespace with dash
  NODE_ID="$(echo "$NODE_ID" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')"
fi
log "Node id: $NODE_ID"
log "API URL: $API_URL"

# ----- query latest version ---------------------------------------------
log "Querying server for latest APK..."
LATEST_JSON="$(curl -fsSL --max-time 30 "$API_URL/api/agent/latest")" || {
  err "Failed to fetch $API_URL/api/agent/latest. Is the server reachable?"
  exit 1
}

LATEST_VERSION_NAME="$(echo "$LATEST_JSON" | sed -n 's/.*"versionName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
LATEST_VERSION_CODE="$(echo "$LATEST_JSON" | sed -n 's/.*"versionCode"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p')"
LATEST_SHA="$(echo "$LATEST_JSON" | sed -n 's/.*"sha256"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
LATEST_SIZE="$(echo "$LATEST_JSON" | sed -n 's/.*"size_bytes"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p')"

if [ -z "$LATEST_VERSION_CODE" ] || [ -z "$LATEST_SHA" ]; then
  err "Server response did not include versionCode/sha256. Server says: $LATEST_JSON"
  exit 1
fi

log "Latest available: v${LATEST_VERSION_NAME} (code ${LATEST_VERSION_CODE}, ${LATEST_SIZE} bytes)"

# ----- check currently installed version --------------------------------
INSTALLED_VERSION_CODE="$(dumpsys package com.example.obdapp 2>/dev/null | \
  sed -n 's/.*versionCode=\([0-9][0-9]*\).*/\1/p' | head -1 || echo "0")"
INSTALLED_VERSION_CODE="${INSTALLED_VERSION_CODE:-0}"

if [ "$FORCE" != "1" ] && [ "${INSTALLED_VERSION_CODE:-0}" -ge "${LATEST_VERSION_CODE:-0}" ]; then
  ok "Already on v${INSTALLED_VERSION_NAME} (code ${INSTALLED_VERSION_CODE}). Nothing to do."
  ok "Use --force to reinstall."
  exit 0
fi

# ----- download + verify -------------------------------------------------
APK_PATH="/data/local/tmp/obd-agent.apk"
log "Downloading APK to $APK_PATH..."
curl -fsSL --max-time 120 -o "$APK_PATH" "$API_URL/api/agent/latest.apk" || {
  err "Download failed."
  exit 1
}

ACTUAL_SIZE="$(stat -c%s "$APK_PATH")"
if [ -n "$LATEST_SIZE" ] && [ "$ACTUAL_SIZE" != "$LATEST_SIZE" ]; then
  err "Downloaded size ($ACTUAL_SIZE) does not match expected ($LATEST_SIZE)."
  exit 1
fi

ACTUAL_SHA="$(sha256sum "$APK_PATH" | awk '{print $1}')"
if [ "$ACTUAL_SHA" != "$LATEST_SHA" ]; then
  err "SHA-256 mismatch."
  err "  expected: $LATEST_SHA"
  err "  actual:   $ACTUAL_SHA"
  rm -f "$APK_PATH"
  exit 1
fi
ok "Download verified (sha256 matches)."

# ----- install -----------------------------------------------------------
log "Installing APK (preserves user prefs)..."
pm install -r -t "$APK_PATH" || {
  err "pm install failed."
  rm -f "$APK_PATH"
  exit 1
}
rm -f "$APK_PATH"
ok "Installed v${LATEST_VERSION_NAME} (code ${LATEST_VERSION_CODE})."

# ----- start the foreground service -------------------------------------
# Use `am` to dispatch the BOOT_COMPLETED broadcast that the
# app listens for; on most head units this re-launches the
# service without rebooting the device.
log "Restarting OBD foreground service..."
am broadcast -a android.intent.action.BOOT_COMPLETED -n com.example.obdapp/.BootReceiver 2>/dev/null || \
  am startservice -n com.example.obdapp/com.example.obdapp.OBDGatewayService 2>/dev/null || \
  warn "Could not auto-start the service. Open the app once to start it."

ok "Done. Open the OBD Telemetry app to verify it starts."
