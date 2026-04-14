# orchd

Bun-first, Codex-first remote control plane for local coding agents.

## Start here

Choose the shortest path that answers your question:

- understand the repo and where to drill down: [`docs/README.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/README.md)
- understand the product wedge and UX: [`docs/product/PRODUCT_MEMO.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/product/PRODUCT_MEMO.md), [`docs/product/DESIGN_DOC.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/product/DESIGN_DOC.md)
- understand system contracts: [`docs/specs/ARCHITECTURE_MEMO.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/specs/ARCHITECTURE_MEMO.md), [`docs/specs/COMMUNICATION_AND_UX_SPEC.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/specs/COMMUNICATION_AND_UX_SPEC.md), [`docs/specs/ENGINEERING_SPEC_V1.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/specs/ENGINEERING_SPEC_V1.md)
- understand validation and evidence flow: [`docs/VALIDATION_HARNESS.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/VALIDATION_HARNESS.md)
- understand the web UI system and route shape: [`docs/operations/UI_SYSTEM_RULES.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/UI_SYSTEM_RULES.md)
- build, validate, or ship locally: [`docs/operations/CONTRIBUTING.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/CONTRIBUTING.md), [`docs/operations/DEPLOYMENT.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/DEPLOYMENT.md), [`docs/operations/RELEASE_CHECKLIST.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/RELEASE_CHECKLIST.md)

## Current scope

This repo currently contains:

- Bun + Hono gateway runtime for Codex-backed local control-plane sessions
- React Router browser shell backed by shadcn-style primitives under `src/web/app/components/ui`
- validation scripts that write evidence under `storage/artifacts/validation/`

It intentionally preserves the architectural boundary from the product docs:

- Codex owns session content, history, approvals, and artifact semantics
- `orchd` owns project bindings, lightweight session references, auth state, terminal state, and validation evidence

## Quick start

```bash
bun install
bun run build:web
bun run start
```

Server defaults:

- host: `127.0.0.1`
- port: `8787`
- db: `storage/orchd.sqlite`
- artifacts: `storage/artifacts`

## Useful commands

```bash
bun run build:web
bun run ui:add -- button
bun run test
bun run validate:docs
bun run validate:m0
bun run validate:m1
bun run validate:m2
bun run validate:m3
bun run validate:m4
bun run validate:m5
bun run validate:template-snake
```

`validate:template-snake` is the repeatable browser template flow: create a binding, start a Codex-backed session from the web UI, approve required actions, and verify the generated single-file Snake game with screenshot evidence.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `ORCHD_HOST` | `127.0.0.1` | HTTP bind host |
| `ORCHD_PORT` | `8787` | HTTP bind port |
| `ORCHD_HOST_ID` | `host_local` | Stable local host identifier |
| `ORCHD_STORAGE_DIR` | `./storage` | Base storage root |
| `ORCHD_DB_PATH` | `./storage/orchd.sqlite` | SQLite metadata database |
| `ORCHD_ARTIFACTS_DIR` | `./storage/artifacts` | Validation and artifact root |
| `ORCHD_ACCESS_MODE` | `local_only` | `local_only` or `self_managed_remote` |
| `ORCHD_TRUST_PROXY` | `false` | Reverse-proxy trust flag |
| `ORCHD_AUTH_PASSWORD` | unset | Single-user login password |
| `ORCHD_PROJECT_PATH_ALLOWLIST` | unset | Optional `:` separated project path allowlist |
| `ORCHD_CODEX_MIN_VERSION` | `0.120.0` | Minimum compatible Codex CLI version |

## Storage layout

```text
storage/
  orchd.sqlite
  artifacts/
    validation/
      latest-template-snake.txt
      <run-id>/
```

`storage/artifacts/validation/<run-id>/` is the canonical evidence bundle root for milestone validation.

## Documentation paths

- progressive-disclosure map: [`docs/README.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/README.md)
- validation/evidence harness: [`docs/VALIDATION_HARNESS.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/VALIDATION_HARNESS.md)
- UI rules and shadcn workflow: [`docs/operations/UI_SYSTEM_RULES.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/UI_SYSTEM_RULES.md)
- contributor workflow: [`docs/operations/CONTRIBUTING.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/CONTRIBUTING.md)
- deployment notes: [`docs/operations/DEPLOYMENT.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/DEPLOYMENT.md)
- release gate: [`docs/operations/RELEASE_CHECKLIST.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/RELEASE_CHECKLIST.md)
- current readiness snapshot: [`docs/operations/ALPHA_READINESS_SUMMARY.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/ALPHA_READINESS_SUMMARY.md)
