# Release Checklist

## Build

- `bun install`
- `bun test`
- `bun run build:web`

## Validation

- `bun run validate:m0`
- `bun run validate:m1`
- `bun run validate:m2`
- `bun run validate:m3`
- `bun run validate:m4`
- `bun run validate:m5`

## Review package

- inspect `storage/artifacts/validation/latest-m5.txt`
- inspect `bundle/evidence-index.json`
- inspect `PRD_ACCEPTANCE_MATRIX_V1.md`
- verify alpha readiness against `VALIDATION_PROGRAM_V1.md`

## Ship gates

- no critical PRD row left without evidence
- degraded-state behavior remains truthful
- mobile session actions remain reachable
- release notes and deployment docs are current
