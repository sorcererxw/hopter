# Go Rebuild Validation Plan

## Purpose

Prepare an honest validation lane for the Go rebuild before backend/frontend implementation is complete.

This plan defines the validation tracks that must eventually pass before the rebuild can claim success, while also giving the repo runnable skeleton scripts today.

## Validation objective

The rebuild is only complete when the browser can drive Codex end to end to produce a working Tetris web game from the new Go + Connect + SSE + React/Vite architecture.

That proof requires four validation lanes:

1. **IDL lane** — protobuf schema quality and deterministic code generation
2. **Backend lane** — Go server startup and health probe through the new entrypoint
3. **UI lane** — `ui/` build health and dist output readiness
4. **Tetris proof lane** — browser-driven session creation and Codex steering to a playable Tetris artifact

## Evidence roots

Each validation script should write a dedicated evidence bundle under:

```text
storage/artifacts/validation/<run-id>/
```

Suggested latest pointers for this rebuild lane:

```text
storage/artifacts/validation/latest-go-idl.txt
storage/artifacts/validation/latest-go-server.txt
storage/artifacts/validation/latest-go-ui.txt
storage/artifacts/validation/latest-go-tetris.txt
```

## Lane 1 — IDL validation

### Goal

Prove that the new `idl/` tree stays lint-clean and can regenerate the committed Go/TS outputs.

### Required checks

- `buf lint`
- `buf generate`
- generated Go files present under `internal/gen/proto/`
- generated TS files present under `ui/src/gen/proto/`

### Current implementation target

- `scripts/validate-go-idl.ts`

### Exit condition

Pass when lint + generation succeed and both generated output roots exist.

## Lane 2 — Go server validation

### Goal

Prove that the new Go entrypoint can compile, start, and answer health probes.

### Required checks

- `go test ./...`
- `go run ./cmd/hopter` (or equivalent entry command)
- `GET /healthz`
- optional `GET /readyz`
- evidence capture for stdout/stderr and probe responses

### Current implementation target

- `scripts/validate-go-server.ts`

### Honest blocking rule

If the repo does not yet contain `go.mod` or `cmd/hopter/main.go`, the lane must report **blocked**, not pass.

### Exit condition

Pass when the server boots from the repo, health returns 200, and the process can be terminated cleanly.

## Lane 3 — UI build validation

### Goal

Prove that the rebuilt `ui/` app can build into a production-ready `ui/dist` bundle.

### Required checks

- `pnpm --dir ui build`
- `ui/dist/index.html` exists
- at least one static asset exists under `ui/dist/assets`

### Current implementation target

- `scripts/validate-go-ui.ts`

### Honest blocking rule

If `ui/package.json` does not exist yet, report **blocked**.

### Exit condition

Pass when a clean build succeeds and emits the expected dist structure.

## Lane 4 — Browser-driven Tetris proof

### Goal

Prove the final user promise:

- browser opens through the Go origin
- user creates/selects a project
- user creates a session from the frontend
- user sends a Tetris request through the frontend
- Codex produces a playable Tetris game in the project workspace
- browser evidence shows the generated game running

### Required preconditions

Backend/frontend completion is needed before this lane can turn green:

- Go server running through the new entrypoint
- Go-origin UI available
- project creation UI wired
- session creation and follow-up input wired
- SSE updates visible enough for the browser to observe progress
- generated output location known so the produced Tetris app can be inspected

### Planned browser flow

1. Open Go origin in Playwright
2. Create/select a project
3. Create a session with a Tetris prompt
4. Observe session status updates and summaries
5. Send follow-up steering input if needed
6. Verify generated web artifact exists on disk
7. Open the generated Tetris app in a browser context
8. Verify keyboard interaction and screenshot evidence

### Current implementation target

- `scripts/validate-go-tetris.ts`

### Honest blocking rule

Until the workspace shell and session workflows exist, this script should emit a **blocked** report with captured precondition evidence.

### Exit condition

Pass when the browser can drive Codex to completion and the generated Tetris app is demonstrably playable.

## Supplemental runtime lane — App Server streaming and approval semantics

### Goal

Prove the behavior of the live `codex app-server` runtime directly, separate from the broader Tetris proof.

Before changing app-server connection behavior, run the documentation guard:

- `HOPTER_APP_SERVER_DOCS_REVIEWED=1 make validate-app-server-docs`

This guard requires the implementer to review the official app-server docs first:

- https://developers.openai.com/codex/app-server

If the docs do not answer the implementation question, inspect the upstream
source before proceeding:

- https://github.com/openai/codex/tree/main/codex-rs/app-server

This lane exists because two claims have different evidence status:

- streaming deltas and reconcile behavior are now runtime-proven
- approval request surfacing is not yet runtime-proven

### Current implementation targets

- `scripts/validate-app-server-runtime.ts`
- `scripts/validate-app-server-approvals.ts`

### What this lane checks

1. SSE draft deltas arrive before transcript refetch
2. finalized-message patches are emitted
3. reconcile-required patches are emitted
4. raw app-server traces are captured for the exercised sessions
5. command/file-change approval probes record whether app-server emits any `server_request`

### Current evidence status

Latest streaming + reconcile evidence:

- `storage/artifacts/validation/app_server_runtime_2026-04-18T04-20-19-045Z`

Latest approval probe evidence:

- `storage/artifacts/validation/app_server_approvals_2026-04-18T04-25-33-618Z`

### Current conclusion

- Streaming path: **pass**
- Reconcile path: **pass**
- Approval path: **not yet proven**

The approval probes currently show:

- real command/file-change prompts can complete
- raw app-server traces are captured
- `server_request` count remains `0` for the tested command and file-change scenarios

That means approval must remain an explicit open item in product and release documents until runtime evidence changes.

## Suggested implementation order

1. Keep IDL lane green during the rebuild
2. Bring up the Go server lane once `go.mod` and `cmd/hopter` exist
3. Bring up the UI build lane once `ui/package.json` exists
4. Wire the Tetris proof lane only after backend + frontend flows are operational

## Non-goals of this validation plan

- pretending blocked lanes are passing
- inventing fake browser success before the Go/UI rebuild is ready
- preserving Bun-era validation semantics for renamed concepts like `project`

## Immediate deliverables

This plan expects the repo to contain:

- `scripts/validate-go-idl.ts`
- `scripts/validate-go-server.ts`
- `scripts/validate-go-ui.ts`
- `scripts/validate-go-tetris.ts`
- helper tests for shared validation status/path logic

## Final release proof

The Go rebuild should not be considered done until the Tetris proof lane is real and passing.
