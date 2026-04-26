#!/usr/bin/env bash
set -euo pipefail

relay_mode=0
reset_auth=0
for arg in "$@"; do
  case "${arg}" in
    --relay)
      relay_mode=1
      ;;
    --reset-auth)
      reset_auth=1
      ;;
    *)
      echo "usage: $0 [--relay] [--reset-auth]" >&2
      exit 2
      ;;
  esac
done

if [[ "${reset_auth}" == "1" && "${relay_mode}" != "1" ]]; then
  echo "--reset-auth requires --relay" >&2
  exit 2
fi

if [[ "${HOPTER_DEV_FOREGROUND:-}" != "1" && -z "${TMUX:-}" && ! -t 0 ]]; then
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  repo_base="$(basename "${repo_root}" | LC_ALL=C sed 's/[^A-Za-z0-9._-]/-/g')"
  repo_hash="$(printf '%s' "${repo_root}" | shasum -a 256 | awk '{print substr($1, 1, 8)}')"
  repo_slug="${repo_base:-workspace}-${repo_hash}"
  tmux_session="hopter-${repo_slug}-dev"
  dev_command="HOPTER_DEV_FOREGROUND=1 bash scripts/dev.sh"
  if [[ "${relay_mode}" == "1" ]]; then
    dev_command="${dev_command} --relay"
  fi
  if [[ "${reset_auth}" == "1" ]]; then
    dev_command="${dev_command} --reset-auth"
  fi

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

exec bun scripts/dev-loop.ts "$@"
