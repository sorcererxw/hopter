#!/usr/bin/env bash
set -euo pipefail

PORTS=(5173 8787)

for port in "${PORTS[@]}"; do
  pids=$(lsof -tiTCP:"${port}" -sTCP:LISTEN -n -P 2>/dev/null || true)

  if [[ -z "${pids}" ]]; then
    echo "port ${port}: no listener"
    continue
  fi

  echo "port ${port}: stopping ${pids}"
  kill ${pids} 2>/dev/null || true
done

sleep 0.5

for port in "${PORTS[@]}"; do
  pids=$(lsof -tiTCP:"${port}" -sTCP:LISTEN -n -P 2>/dev/null || true)
  if [[ -n "${pids}" ]]; then
    echo "port ${port}: force stopping ${pids}"
    kill -9 ${pids} 2>/dev/null || true
  fi
done

rm -rf tmp/air

echo "dev loop reset complete"
