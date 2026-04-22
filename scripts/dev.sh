#!/usr/bin/env bash
set -euo pipefail

if [[ "${HOPTER_DEV_FOREGROUND:-}" != "1" && -z "${TMUX:-}" && ! -t 0 ]]; then
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  repo_slug="$(basename "${repo_root}" | LC_ALL=C sed 's/[^A-Za-z0-9._-]/-/g')"
  tmux_session="hopter-${repo_slug}-dev"
  dev_command="HOPTER_DEV_FOREGROUND=1 make dev"

  has_listener() {
    lsof -tiTCP:"$1" -sTCP:LISTEN -n -P >/dev/null 2>&1
  }

  if command -v tmux >/dev/null 2>&1; then
    if tmux has-session -t "${tmux_session}" 2>/dev/null; then
      if has_listener 5173 && has_listener 8787; then
        echo "[supervisor] tmux session ${tmux_session} already has live dev listeners"
      else
        echo "[supervisor] tmux session ${tmux_session} exists but dev listeners are incomplete; starting a fresh dev window"
        tmux new-window -d -t "${tmux_session}:" -n dev -c "${repo_root}" "make reset && ${dev_command}"
      fi
    else
      echo "[supervisor] starting tmux session ${tmux_session}"
      tmux new-session -d -s "${tmux_session}" -n dev -c "${repo_root}" "${dev_command}"
    fi

    echo "[supervisor] attach with: tmux attach -t ${tmux_session}"
    exit 0
  fi

  echo "[supervisor] tmux not found; running foreground in a non-interactive shell" >&2
fi

exec bun scripts/dev-loop.ts
