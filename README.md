# orchd

Bun-first, Codex-first remote control plane for local coding agents.

## Current scope

This repo currently contains:

- M0 feasibility spikes for Bun + Codex app-server
- M1 gateway foundation: config, DB bootstrap, host/backends APIs, project CRUD
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
bun run test
bun run validate:m0
bun run validate:m1
bun run validate:m2
bun run validate:m3
bun run validate:m4
bun run validate:m5
```

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
      <run-id>/
```

`storage/artifacts/validation/<run-id>/` is the canonical evidence bundle root for milestone validation.

## Docs

- `docs/DEPLOYMENT.md`
- `docs/CONTRIBUTING.md`
- `docs/RELEASE_CHECKLIST.md`
- `docs/ALPHA_READINESS_SUMMARY.md`
