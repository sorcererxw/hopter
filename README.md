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
```

`make dev` is the preferred local loop. It starts:

- `pnpm --dir ui dev`
- `go run ./cmd/orchd`

and if either process exits, the other one is terminated too. The launcher now waits for Vite to become ready before starting the Go server, which avoids initial `502/503` errors on early `/src/*` dev-module requests.

`make dev` now binds the dev surfaces to `0.0.0.0` by default.

Examples:

```bash
make dev
```

By default, `make dev` keeps the Go server aligned with the UI dev bind host, so both Vite and Go listen on `0.0.0.0`.

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
