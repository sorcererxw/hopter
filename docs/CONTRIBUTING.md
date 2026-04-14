# Contributing

## Architectural guardrails

- Codex is the source of truth for session content/history/approval semantics.
- `orchd` stores only lightweight session references plus validation evidence.
- Do not turn the product into a browser IDE or terminal-first shell.
- Session detail must keep this hierarchy:
  1. status
  2. summary
  3. attention
  4. artifacts
  5. timeline
  6. terminal

## Local workflow

```bash
bun install
bun test
bun run build:web
```

Validation commands:

```bash
bun run validate:m0
bun run validate:m1
bun run validate:m2
bun run validate:m3
bun run validate:m4
bun run validate:m5
```

## Repository shape

- `src/server/*` — gateway runtime
- `src/web/*` — browser control plane
- `src/shared/*` — shared contracts/domain
- `scripts/*` — milestone validation and release helpers
- `storage/artifacts/validation/*` — evidence bundles

## Definition of done

Implementation is not enough.

Every major change must leave:

- passing validation
- evidence bundle output
- updated requirement mapping when PRD rows are affected
