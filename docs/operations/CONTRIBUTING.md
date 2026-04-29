# Contributing

## Active stack

`hopter` is now actively developed as:

- Go backend
- Connect control-plane API
- SSE notification stream
- React + Vite frontend in `ui/`
- protobuf/Buf contract layer in `idl/`

The old Bun-first runtime and `src/server` / `src/web` structure are obsolete.

## Documentation paths

Use the docs progressively:

- repo/doc map: [`docs/README.md`](../README.md)
- master plan: [`docs/planning/GO_REBUILD_MASTER_PLAN.md`](../planning/GO_REBUILD_MASTER_PLAN.md)
- detailed task list: [`docs/planning/GO_REBUILD_TASK_LIST.md`](../planning/GO_REBUILD_TASK_LIST.md)
- backend plan: [`docs/planning/BACKEND_EXECUTION_PLAN.md`](../planning/BACKEND_EXECUTION_PLAN.md)
- frontend plan: [`docs/planning/FRONTEND_EXECUTION_PLAN.md`](../planning/FRONTEND_EXECUTION_PLAN.md)
- IDL plan: [`docs/planning/IDL_EXECUTION_PLAN.md`](../planning/IDL_EXECUTION_PLAN.md)
- validation/evidence guide: [`docs/VALIDATION_HARNESS.md`](../VALIDATION_HARNESS.md)
- local dev loop, watch behavior, and file-based logs: [`docs/operations/DEV_LOOP.md`](DEV_LOOP.md)
- UI rules: [`docs/operations/UI_SYSTEM_RULES.md`](UI_SYSTEM_RULES.md)

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
make validate-app-server-docs
make validate-all
```

### Direct commands

```bash
go test ./...
go run ./cmd/hopter
pnpm --dir ui typecheck
pnpm --dir ui build
pnpm --dir ui lint
pnpm --dir ui dev
go run ./cmd/hopter --dev-proxy-url http://127.0.0.1:5173
cd idl && buf lint
cd idl && buf generate
bun scripts/validate-docs.ts
bun scripts/validate-go-idl.ts
bun scripts/validate-go-server.ts
bun scripts/validate-go-ui.ts
bun scripts/validate-go-terminal.ts
bun scripts/validate-go-tetris.ts
bun scripts/validate-app-server-docs.ts
bun scripts/validate-live.ts
```

For work that changes the `codex app-server` connection path, read
https://developers.openai.com/codex/app-server before implementation and run:

```bash
HOPTER_APP_SERVER_DOCS_REVIEWED=1 make validate-app-server-docs
```

If the official docs leave any protocol or runtime detail unclear, inspect
https://github.com/openai/codex/tree/main/codex-rs/app-server and also set
`HOPTER_APP_SERVER_UPSTREAM_REVIEWED=1` for the guard run.

## Distribution build contract

`hopter` uses build-time install-source metadata to decide update ownership.

Required ldflags:

- `main.version`
- `main.installSource`

Examples:

```bash
go build -ldflags "-X main.version=0.4.2 -X main.installSource=direct" ./cmd/hopter
go build -ldflags "-X main.version=0.4.2 -X main.installSource=homebrew_formula" ./cmd/hopter
go build -ldflags "-X main.version=0.4.2 -X main.installSource=npm" ./cmd/hopter
```

Release builds with a non-`dev` `main.version` default to `0.0.0.0:18787`.
Dev builds default to `0.0.0.0:8787`, which keeps an installed release
independent from `make dev`. Use `--host` and `--port` for direct server
debugging.

The release workflow creates the next `v0.0.x` tag, then GoReleaser publishes
GitHub release assets and updates the Homebrew tap. npm packages are generated
afterward as a single `hopter` package whose postinstall script downloads the
current platform's `hopter-npm-<os>-<arch>` asset from the same GitHub release.
Create or reuse `sorcererxw/tap`, then ensure `RELEASE_TOKEN` can create the
GitHub release and push to that tap. Because this tap repo intentionally is not
named `homebrew-tap`, users install it with an explicit remote:
`brew tap --custom-remote sorcererxw/tap https://github.com/sorcererxw/tap`.

For npm publishing, create the public `hopter-cli` package, then configure
`NPM_TOKEN` in GitHub Actions. The workflow publishes only that package. npm
package updates remain package-manager owned: `npm update -g hopter-cli`
installs the new package version and reruns postinstall to fetch the matching
binary.

Current intended values:

- `direct`
- `homebrew_formula`
- `homebrew_cask`
- `npm`
- `apt`
- `dnf`
- `winget`
- `nix`
- `macports`
- `snap`
- `flatpak`

Rules:

1. Treat build-time `installSource` as the primary product signal.
2. Do not rely on runtime path guessing for the normal ownership decision.

Unless a signed update manifest is configured in code, `hopter` now checks the
latest GitHub release on `sorcererxw/hopter`. Direct-install self-update expects
the release to publish raw per-platform binaries named `hopter-<os>-<arch>`
alongside `checksums.txt`. GoReleaser uses `hopter-homebrew-<os>-<arch>` assets
for the Homebrew tap, and the npm postinstall script uses
`hopter-npm-<os>-<arch>` assets so its build-time `installSource` metadata stays
accurate.

In dev, the browser should still enter through the Go origin.

`make dev` is the recommended local workflow. It now runs a Bun supervisor that:

- starts Vite
- starts Go hot reload through `air`
- writes machine-readable dev state to `~/.hopter/devlogs/<repo-slug>/state.json`
- writes persistent append-only logs to `~/.hopter/devlogs/<repo-slug>/`
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
~/.hopter/devlogs/<repo-slug>/
  supervisor.jsonl
  go.jsonl
  vite.jsonl
  browser.jsonl
  timeline.jsonl
```

`timeline.jsonl` is the main AI-facing entrypoint. Use `tail`, `rg`, or `jq` directly. Do not build another API on top of this.

If you need the deeper explanation for the local loop, including what is watched automatically and how `make verify-live` fits into the fast path, read [`docs/operations/DEV_LOOP.md`](DEV_LOOP.md).

`make dev` binds the dev surfaces to `0.0.0.0`.

Examples:

```bash
make dev
```

The dev launcher keeps the Go server aligned with the UI bind host, so both Vite and Go listen on `0.0.0.0` in the local loop.

## UI system workflow

The frontend keeps:

- Tailwind CSS
- HeroUI v3 components

Rules:

1. Do not restore the shadcn registry workflow or generated primitive tree.
2. Do not hand-roll a second primitive layer.
3. Keep app-specific meaning in `ui/src/components/app` or feature components, not inside primitive wrappers.

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
