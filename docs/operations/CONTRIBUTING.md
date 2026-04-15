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
- UI rules: [`docs/operations/UI_SYSTEM_RULES.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/UI_SYSTEM_RULES.md)

## Local workflow

### Preferred entrypoints

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
bun scripts/validate-go-tetris.ts
```

In dev, the browser should still enter through the Go origin.

`make dev` is the recommended local workflow. It starts Vite and Go together, waits for Vite to become ready before bringing up the Go origin, and tears both down if either process exits.

`make dev` now binds the dev surfaces to `0.0.0.0` by default.

Examples:

```bash
make dev
```

The dev launcher keeps the Go server aligned with the UI bind host, so both Vite and Go listen on `0.0.0.0` in the default local loop.

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
