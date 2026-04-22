# Dev Loop

This document is the progressive-disclosure reference for local development in `hopter`.

Use it when you need to answer one of four questions:

1. how to start the local stack
2. what is watching and restarting automatically
3. where AI should read machine state and logs
4. how to validate the current live loop without rebuilding everything

If you only need the shortest path, start with [`README.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/README.md).
If you need the full contributor workflow, read [`docs/operations/CONTRIBUTING.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/CONTRIBUTING.md).

## One-screen summary

The local development loop is:

```text
make reset
  -> frees stale listeners on 5173 and 8787

make dev
  -> starts the Bun supervisor
  -> starts Vite
  -> starts Go hot reload through air
  -> writes persistent dev state + logs outside the repo

make verify-live
  -> waits for state=ready
  -> runs a lightweight browser smoke through the Go origin
  -> records evidence under storage/artifacts/validation/
```

The browser still enters through the Go origin in dev.

## Start with the smallest useful command

Use the narrowest command that answers your question:

- Need a clean slate: `make reset`
- Need the live stack: `make dev`
- Need a quick smoke check on the running stack: `make verify-live`
- Need release-style evidence: `make validate-go-*`

Do not use `make validate-go-*` as your default inner loop. Those scripts are for proof and evidence, not for fast iteration.

## What `make dev` actually does

`make dev` is the single authority for local development.

It does not run a one-shot `go run` anymore. It runs a Bun supervisor that:

1. starts Vite on port `5173`
2. waits for Vite to become ready
3. starts Go hot reload through `air`
4. keeps watching Go files for rebuilds
5. maintains machine-readable state for AI agents
6. writes persistent append-only logs outside the repo

If the stack cannot start, the supervisor fails early and explains why in the console.

Example:

```bash
make dev
```

## What is watched automatically

There are two watch loops:

### 1. Frontend watch

Vite watches the frontend under `ui/`.

Typical effect:

- edit `ui/src/**`
- Vite rebuilds the changed module
- browser updates without restarting Go

### 2. Backend watch

`air` watches the Go tree and rebuilds the Go server.

Configured roots include:

- `cmd/`
- `internal/`
- `idl/`
- `scripts/`
- docs and other repo files that may affect the local loop

Configured exclusions include:

- `ui/`
- `storage/`
- `tmp/`
- `node_modules/`

The config lives in [`.air.toml`](/Users/sorcererxw/repo/sorcererxw/codeshell/.air.toml).

## Machine-readable dev state

The local loop writes state to:

```text
~/.hopter/devlogs/<repo-slug>/state.json
```

For this repo the usual path is:

```text
~/.hopter/devlogs/codeshell/state.json
```

State values:

- `starting`
- `rebuilding`
- `ready`
- `build_failed`
- `stopped`

AI agents should treat this file as the authority for "should I wait, or is the loop broken?"

Typical usage:

```bash
cat ~/.hopter/devlogs/codeshell/state.json
```

## File-based log plane

The local loop writes append-only JSONL logs to:

```text
~/.hopter/devlogs/<repo-slug>/
```

Files:

- `supervisor.jsonl` — state transitions, startup, shutdown, preflight failures
- `go.jsonl` — Go build/run output
- `vite.jsonl` — Vite dev server output
- `browser.jsonl` — browser smoke logs from `make verify-live`
- `timeline.jsonl` — merged cross-source time-ordered stream

Why this is outside the repo:

- cross-restart persistence
- zero git pollution
- easy for AI to read with `tail`, `rg`, and `jq`

Do not wrap this in another local API for AI. Read the files directly.

## Dev runtime state isolation

When the Go server runs in dev-proxy mode, Hopter uses a dev-scoped state home by
default:

```text
~/.hopter/devstate/<repo-slug>-<repo-path-hash>/
```

That keeps the dev task store from locking the normal Hopter task store at:

```text
~/.hopter/tasks/badger/
```

This matters because the Badger-backed task store is intentionally single-writer.
A release or direct `hopter` process can run beside `make dev` without colliding
with the dev loop's task metadata. This path is chosen by Hopter itself; do not
use an environment-variable override to avoid the collision.

Examples:

```bash
tail -f ~/.hopter/devlogs/codeshell/timeline.jsonl
rg '"status":"build_failed"|Port 5173|address already in use' ~/.hopter/devlogs/codeshell/
jq -c 'select(.source=="supervisor")' ~/.hopter/devlogs/codeshell/timeline.jsonl | tail -n 20
```

## Console logs vs file logs

`make dev` prints logs to the console for humans.

That console output now supports highlighting in a real terminal:

- source prefixes: `supervisor`, `vite`, `go`
- ready/running success lines
- rebuilding/building lines
- error/failure lines

This does **not** change the file logs. The JSONL files stay machine-friendly and uncolored.

Set `NO_COLOR=1` if you want plain console output.

## What `make verify-live` is for

`make verify-live` is the fast validation lane for the running local loop.

It does not start a second server.

It does this:

1. reads `state.json`
2. waits for `state=ready`
3. checks the Go health endpoint
4. opens the Go origin in Playwright
5. runs a lightweight workspace smoke
6. writes evidence under `storage/artifacts/validation/verify_live_<timestamp>/`
7. appends browser smoke events to `browser.jsonl`

Example:

```bash
make verify-live
```

Use this after edits when you want a quick answer to "is the live stack healthy right now?"

## When to use `make reset`

Use `make reset` when:

- `make dev` says a port is already in use
- an old Vite process is still holding `5173`
- an old Go process is still holding `8787`
- `tmp/air` needs to be cleared

Example:

```bash
make reset
make dev
```

`make reset` is intentionally narrow. It only frees the usual dev ports and clears `tmp/air`.

## Troubleshooting by symptom

### `make dev` says a port is already in use

Run:

```bash
make reset
```

If you want to inspect first:

```bash
lsof -iTCP:5173 -sTCP:LISTEN -n -P
lsof -iTCP:8787 -sTCP:LISTEN -n -P
```

### The browser looks stale after a Go edit

Read:

```bash
cat ~/.hopter/devlogs/codeshell/state.json
tail -n 50 ~/.hopter/devlogs/codeshell/timeline.jsonl
```

If the state is `rebuilding`, wait.
If the state is `build_failed`, inspect `go.jsonl`.

### `make verify-live` fails

Read:

```bash
cat ~/.hopter/devlogs/codeshell/state.json
tail -n 100 ~/.hopter/devlogs/codeshell/browser.jsonl
cat storage/artifacts/validation/latest-verify-live.txt
```

The latest evidence root will point to the summary and screenshots for the last live smoke run.

## Relationship to the proof harness

There are now two lanes:

### Fast inner loop

- `make dev`
- `make verify-live`
- file-based logs in `~/.hopter/devlogs/`

### Evidence / proof lane

- `make validate-go-idl`
- `make validate-go-server`
- `make validate-go-ui`
- `make validate-go-terminal`
- `make validate-go-tetris`

Use the first lane for daily iteration. Use the second lane when you need durable proof artifacts.
