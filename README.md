# orchd

Go-native remote control plane for local coding agents, with a React + Vite UI served by the same Go process.

## Current active architecture

- **Backend**: Go
- **Router**: Go 1.22+ `http.ServeMux`
- **Control-plane API**: Connect
- **Realtime notifications**: SSE
- **Frontend**: React + Vite under `ui/`
- **IDL**: protobuf + Buf under `idl/`
- **Production delivery**: Go binary serves the built UI from `ui/dist`
- **Development entrypoint**: Go remains the browser origin and can reverse-proxy the Vite dev server

## Start here

Choose the shortest path that answers your question:

- repo/doc map: [`docs/README.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/README.md)
- active rebuild master plan: [`docs/planning/GO_REBUILD_MASTER_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/GO_REBUILD_MASTER_PLAN.md)
- detailed task list: [`docs/planning/GO_REBUILD_TASK_LIST.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/GO_REBUILD_TASK_LIST.md)
- backend execution plan: [`docs/planning/BACKEND_EXECUTION_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/BACKEND_EXECUTION_PLAN.md)
- frontend execution plan: [`docs/planning/FRONTEND_EXECUTION_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/FRONTEND_EXECUTION_PLAN.md)
- IDL execution plan: [`docs/planning/IDL_EXECUTION_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/IDL_EXECUTION_PLAN.md)
- concrete first-pass protobuf surface: [`docs/planning/IDL_SURFACE_V1_DRAFT.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/IDL_SURFACE_V1_DRAFT.md)
- rebuilt UI design: [`docs/product/UI_REBUILD_DESIGN_DOC.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/product/UI_REBUILD_DESIGN_DOC.md)
- validation harness: [`docs/VALIDATION_HARNESS.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/VALIDATION_HARNESS.md)
- local dev loop, watch behavior, and file-based logs: [`docs/operations/DEV_LOOP.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/DEV_LOOP.md)

## Repository shape

```text
/cmd
/internal
/idl
/ui
/scripts
/docs
```

## Core commands

### Common entrypoints

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
make validate-go-tetris
make validate-app-server-runtime
make validate-app-server-approvals
make validate-interrupt-ui
make validate-all
```

### Direct commands still available

```bash
go test ./...
go run ./cmd/orchd
pnpm --dir ui dev
pnpm --dir ui typecheck
pnpm --dir ui build
pnpm --dir ui lint
cd idl && buf lint
cd idl && buf generate
bun scripts/validate-docs.ts
bun scripts/validate-go-idl.ts
bun scripts/validate-go-server.ts
bun scripts/validate-go-ui.ts
bun scripts/validate-go-tetris.ts
bun scripts/validate-live.ts
bun scripts/validate-app-server-runtime.ts
bun scripts/validate-app-server-approvals.ts
bun scripts/validate-interrupt-ui.ts
```

## Build metadata and install source

`orchd` now expects two important build-time ldflags:

- `main.version`
- `main.installSource`

The install source controls update ownership:

- `direct` -> self-managed update path
- `homebrew_formula` -> package-managed update path
- `homebrew_cask` -> package-managed update path

Minimal direct build example:

```bash
go build -ldflags "-X main.version=0.4.2 -X main.installSource=direct" ./cmd/orchd
```

Homebrew formula build example:

```bash
go build -ldflags "-X main.version=0.4.2 -X main.installSource=homebrew_formula" ./cmd/orchd
```

`ORCHD_INSTALL_SOURCE` still exists as a runtime override for validation and debugging, but the normal product path should treat the build-time install source as the primary signal.

`make dev` is the preferred local loop. It now runs an AI-first supervisor that starts:

- `pnpm --dir ui dev`
- Go hot reload through `air`

The supervisor keeps a persistent machine-readable dev state under:

```text
~/.orchd/devlogs/<repo-slug>/state.json
```

State values:

- `starting`
- `rebuilding`
- `ready`
- `build_failed`
- `stopped`

It also keeps append-only JSONL logs under:

```text
~/.orchd/devlogs/<repo-slug>/
  supervisor.jsonl
  go.jsonl
  vite.jsonl
  browser.jsonl
  timeline.jsonl
```

The log plane is outside the repo on purpose so AI agents can `tail`, `rg`, and `jq` it directly without polluting git or losing context on restart.

If you need the full local-loop reference, including service watch behavior and how AI should read the file-based log plane, read [`docs/operations/DEV_LOOP.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/DEV_LOOP.md).

`make dev` still waits for Vite before bringing up the Go origin, which avoids the initial `502/503` burst on early `/src/*` dev-module requests, and it now tracks Go readiness continuously after every rebuild.

`make dev` binds the dev surfaces to `0.0.0.0` by default.

Examples:

```bash
make dev
make verify-live
```

`make verify-live` attaches to the existing dev loop instead of starting a second server. It waits for the persistent dev state to become `ready`, then runs a lightweight browser smoke check through the Go origin and records evidence under:

```text
storage/artifacts/validation/verify_live_<timestamp>/
```

By default, `make dev` keeps the Go server aligned with the UI dev bind host, so both Vite and Go listen on `0.0.0.0`. Set `ORCHD_AIR_BIN=/path/to/air` if you want to use a preinstalled `air`; otherwise the supervisor falls back to `go run github.com/air-verse/air@latest`.

If you need a different bind host for debugging, you can still override `ORCHD_UI_DEV_HOST` and/or `ORCHD_HOST`.

## Current proof point

The active rebuild already proves the main product loop:

- the frontend can create a project
- the frontend can create a Codex-backed session
- the frontend can drive Codex to generate a working Tetris web game

Latest Tetris proof evidence:

- `storage/artifacts/validation/go_tetris_2026-04-15T08-40-01-569Z`

## Notes

- Development auth is intentionally weak and localhost-only.
- Relay and terminal are deferred.
- The old Bun-first runtime and binding-based surfaces are no longer the active implementation path.
