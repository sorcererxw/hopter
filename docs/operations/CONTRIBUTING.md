# Contributing

## Documentation paths

Use the docs progressively instead of reading every spec front to back:

- repo/doc map: [`docs/README.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/README.md)
- validation/evidence guide: [`docs/VALIDATION_HARNESS.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/VALIDATION_HARNESS.md)
- UI system rules: [`docs/operations/UI_SYSTEM_RULES.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/UI_SYSTEM_RULES.md)

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

LAN testing:

```bash
bun run dev:lan
```

Validation commands:

```bash
bun run validate:docs
bun run validate:m0
bun run validate:m1
bun run validate:m2
bun run validate:m3
bun run validate:m4
bun run validate:m5
bun run validate:template-snake
```

Use `bun run validate:template-snake` when you need a product-facing browser smoke test that proves the app can create a binding and drive Codex to deliver a small web artifact end to end.

## UI system workflow

Add new primitive UI only through the shadcn CLI flow:

```bash
bun run ui:add -- button
```

Rules:

- do not hand-write a second primitive layer outside `src/web/app/components/ui`
- put orchd-specific meaning in `src/web/app/components/orchd`
- prefer token and wrapper changes before page-local one-off styles
- keep the React Router route tree thin, route files should compose product components instead of growing into 700-line blobs again

Contributor fast path for UI work:

1. read `README.md`
2. read `docs/operations/UI_SYSTEM_RULES.md`
3. run `bun install`
4. run `bun run build:web` or `bun run dev:lan`
5. if a new primitive is truly needed, run `bun run ui:add -- <component>`
6. update the relevant browser validation and record the evidence path

## Repository shape

- `src/server/*` — gateway runtime
- `src/web/*` — browser control plane
- `src/shared/*` — shared contracts/domain
- `scripts/*` — milestone validation and release helpers
- `storage/artifacts/validation/*` — evidence bundles
- `docs/README.md` — progressive-disclosure doc index
- `docs/VALIDATION_HARNESS.md` — validation and evidence on-ramp

## Definition of done

Implementation is not enough.

Every major change must leave:

- passing validation
- evidence bundle output
- updated requirement mapping when PRD rows are affected
