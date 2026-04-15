#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  local exit_code=$?
  if [[ -n "${UI_PID:-}" ]]; then
    kill "${UI_PID}" 2>/dev/null || true
  fi
  if [[ -n "${GO_PID:-}" ]]; then
    kill "${GO_PID}" 2>/dev/null || true
  fi
  wait "${UI_PID:-}" 2>/dev/null || true
  wait "${GO_PID:-}" 2>/dev/null || true
  exit "${exit_code}"
}

trap cleanup EXIT INT TERM

UI_DEV_HOST="${ORCHD_UI_DEV_HOST:-0.0.0.0}"
UI_DEV_PROXY_HOST="${ORCHD_UI_DEV_PROXY_HOST:-$UI_DEV_HOST}"
GO_DEV_HOST="${ORCHD_HOST:-$UI_DEV_HOST}"
GO_LOCALHOST_ONLY_NO_AUTH="${ORCHD_LOCALHOST_ONLY_NO_AUTH:-false}"

case "${UI_DEV_PROXY_HOST}" in
  ""|"0.0.0.0")
    UI_DEV_PROXY_HOST="127.0.0.1"
    ;;
  "::"|"[::]")
    UI_DEV_PROXY_HOST="[::1]"
    ;;
esac

case "${GO_DEV_HOST}" in
  ""|"0.0.0.0"|"::"|"[::]")
    if [[ -z "${ORCHD_LOCALHOST_ONLY_NO_AUTH:-}" ]]; then
      GO_LOCALHOST_ONLY_NO_AUTH="false"
    fi
    ;;
esac

ORCHD_UI_DEV_HOST="${UI_DEV_HOST}" pnpm --dir ui dev &
UI_PID=$!

UI_DEV_PROXY_URL="${ORCHD_UI_DEV_PROXY_URL:-http://${UI_DEV_PROXY_HOST}:5173}"

for _ in $(seq 1 120); do
  if curl -fsS "${UI_DEV_PROXY_URL}" >/dev/null 2>&1; then
    break
  fi

  if ! kill -0 "${UI_PID}" 2>/dev/null; then
    echo "vite dev server exited before becoming ready" >&2
    wait "${UI_PID}" || true
    exit 1
  fi

  sleep 0.25
done

if ! curl -fsS "${UI_DEV_PROXY_URL}" >/dev/null 2>&1; then
  echo "vite dev server did not become ready at ${UI_DEV_PROXY_URL}" >&2
  exit 1
fi

ORCHD_HOST="${GO_DEV_HOST}" \
ORCHD_LOCALHOST_ONLY_NO_AUTH="${GO_LOCALHOST_ONLY_NO_AUTH}" \
ORCHD_UI_DEV_PROXY_URL="${UI_DEV_PROXY_URL}" \
go run ./cmd/orchd &
GO_PID=$!

wait -n "${UI_PID}" "${GO_PID}"
