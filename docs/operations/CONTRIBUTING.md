# Contributing

## Active stack

`orchd` is now actively developed as:

- Go backend
- Connect control-plane API
- SSE notification stream
- React + Vite frontend in `ui/`
- protobuf/Buf contract layer in `idl/`

The old Bun-first runtime and `src/server` / `src/web` structure are obsolete.

## Documentation paths

Use the docs progressively:

- repo/doc map: [`docs/README.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/README.md)
- master plan: [`docs/planning/GO_REBUILD_MASTER_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/GO_REBUILD_MASTER_PLAN.md)
- detailed task list: [`docs/planning/GO_REBUILD_TASK_LIST.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/GO_REBUILD_TASK_LIST.md)
- backend plan: [`docs/planning/BACKEND_EXECUTION_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/BACKEND_EXECUTION_PLAN.md)
- frontend plan: [`docs/planning/FRONTEND_EXECUTION_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/FRONTEND_EXECUTION_PLAN.md)
- IDL plan: [`docs/planning/IDL_EXECUTION_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/IDL_EXECUTION_PLAN.md)
- validation/evidence guide: [`docs/VALIDATION_HARNESS.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/VALIDATION_HARNESS.md)
- local dev loop, watch behavior, and file-based logs: [`docs/operations/DEV_LOOP.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/DEV_LOOP.md)
- UI rules: [`docs/operations/UI_SYSTEM_RULES.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/UI_SYSTEM_RULES.md)

## Local workflow

### Preferred entrypoints

```bash
make dev
make verify-live
make go-test
make go-run
make ui-dev
make ui-typecheck
make ui-build
make ui-lint
make proto
make test
make docs
make validate-go-idl
make validate-go-server
make validate-go-ui
make validate-go-terminal
make validate-go-tetris
make validate-all
```

### Direct commands

```bash
go test ./...
go run ./cmd/orchd
pnpm --dir ui typecheck
pnpm --dir ui build
pnpm --dir ui lint
pnpm --dir ui dev
ORCHD_UI_DEV_PROXY_URL=http://127.0.0.1:5173 go run ./cmd/orchd
cd idl && buf lint
cd idl && buf generate
bun scripts/validate-docs.ts
bun scripts/validate-go-idl.ts
bun scripts/validate-go-server.ts
bun scripts/validate-go-ui.ts
bun scripts/validate-go-terminal.ts
bun scripts/validate-go-tetris.ts
bun scripts/validate-live.ts
```

## Distribution build contract

`orchd` uses build-time install-source metadata to decide update ownership.

Required ldflags:

- `main.version`
- `main.installSource`

Examples:

```bash
go build -ldflags "-X main.version=0.4.2 -X main.installSource=direct" ./cmd/orchd
go build -ldflags "-X main.version=0.4.2 -X main.installSource=homebrew_formula" ./cmd/orchd
```

Current intended values:

- `direct`
- `homebrew_formula`
- `homebrew_cask`
- `apt`
- `dnf`
- `winget`
- `nix`
- `macports`
- `snap`
- `flatpak`

Rules:

1. Treat build-time `installSource` as the primary product signal.
2. Use `ORCHD_INSTALL_SOURCE` only for debugging, validation, and local overrides.
3. Do not rely on runtime path guessing for the normal ownership decision.

In dev, the browser should still enter through the Go origin.

`make dev` is the recommended local workflow. It now runs a Bun supervisor that:

- starts Vite
- starts Go hot reload through `air`
- writes machine-readable dev state to `~/.orchd/devlogs/<repo-slug>/state.json`
- writes persistent append-only logs to `~/.orchd/devlogs/<repo-slug>/`
- keeps the browser entering through the Go origin in dev

The dev state is the authority for AI agents:

- `starting`
- `rebuilding`
- `ready`
- `build_failed`
- `stopped`

Use `make verify-live` after edits. It attaches to the current dev loop, waits for `ready`, runs a lightweight browser smoke through the Go origin, and records evidence under `storage/artifacts/validation/verify_live_<timestamp>/`.

Persistent log files:

```text
~/.orchd/devlogs/<repo-slug>/
  supervisor.jsonl
  go.jsonl
  vite.jsonl
  browser.jsonl
  timeline.jsonl
```

`timeline.jsonl` is the main AI-facing entrypoint. Use `tail`, `rg`, or `jq` directly. Do not build another API on top of this.

If you need the deeper explanation for the local loop, including what is watched automatically and how `make verify-live` fits into the fast path, read [`docs/operations/DEV_LOOP.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/DEV_LOOP.md).

`make dev` binds the dev surfaces to `0.0.0.0` by default.

Examples:

```bash
make dev
```

The dev launcher keeps the Go server aligned with the UI bind host, so both Vite and Go listen on `0.0.0.0` in the default local loop. Set `ORCHD_AIR_BIN=/path/to/air` if you want to use a preinstalled `air`; otherwise the supervisor falls back to `go run github.com/air-verse/air@latest`.

If you need a different bind host for debugging, you can still override `ORCHD_UI_DEV_HOST` and/or `ORCHD_HOST`.

## UI system workflow

The frontend keeps:

- Tailwind CSS
- shadcn/ui primitives

Rules:

1. New primitives must come from the official shadcn CLI.
2. Do not hand-roll a second primitive layer.
3. Keep app-specific meaning in `ui/src/components/app` or feature components, not inside primitive files.

## Repository shape

- `cmd/` — Go entrypoints
- `internal/` — Go runtime implementation
- `idl/` — protobuf + Buf
- `ui/` — React + Vite app
- `scripts/` — validation and release helpers
- `storage/artifacts/validation/` — evidence bundles

## Definition of done

Implementation is not enough.

Every meaningful change should leave:

- passing checks
- validation evidence where applicable
- docs updated when architecture, protocol, or workflow changed
