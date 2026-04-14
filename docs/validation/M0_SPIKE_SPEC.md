# M0 Spike Spec

## Goal

Prove the highest-risk technical assumptions for `orchd` before the full gateway is built:

- Bun can host the gateway process cleanly
- Codex can be detected and version-gated
- `codex app-server` can be driven over `stdio`
- a lightweight session reference can be captured without mirroring session history
- approval requests can be detected and answered through the app-server protocol
- Bun process primitives are sufficient for the future terminal surface, with documented gaps
- validation evidence can be captured in a durable, reviewable artifact layout

## Product boundary reminder

This spike must preserve the core architecture:

- Codex remains the source of truth for session content, history, approvals, and artifact semantics
- `orchd` keeps only ephemeral control-plane metadata and durable validation evidence
- the browser never talks to Codex directly
- the gateway is the only Codex client

## Transport decision

The primary integration target is:

```text
gateway <-> codex app-server over stdio
```

Not:

- browser direct to Codex
- a terminal scraper
- `codex exec --json` as the main session protocol

## What the spike must prove

### 1. Spawn `codex app-server`

The gateway-side runner should:

- launch `codex app-server` as a child process
- keep stdin/stdout open for JSON-RPC-like message exchange
- capture stderr separately for diagnostics
- tolerate non-protocol stderr noise without confusing it for app-server events

### 2. Speak over `stdio`

The minimal proven flow is:

1. send `initialize`
2. send `thread/start`
3. send `turn/start`
4. observe notifications
5. optionally send `thread/resume`

The spike should persist raw line-delimited protocol traffic append-only for evidence.

## Lightweight session reference

The gateway-owned reference should stay small. It should capture only fields needed to reconnect and render control-plane state:

- gateway session id
- project id
- backend id (`codex`)
- backend session id / thread id
- thread path if available
- cwd
- created/updated timestamps
- coarse status

It must not store a full mirror of Codex history.

## Approval detection and response

The spike should prove that the gateway can distinguish:

- normal notifications
- normal request responses
- server-initiated approval requests

For approval handling, the proven contract is:

- detect the server request method
- route it through a gateway policy hook
- respond with the protocol-specific approval payload

The spike may use canned accept responses for proof, but must preserve the method-specific response shapes.

## Bun terminal viability

The spike should evaluate Bun-owned process behavior needed for the later terminal drawer:

- start shell in target cwd
- interactive stdin/stdout round-trip
- predictable close behavior
- resize support, or an explicit note that a PTY-specific layer is still required

If resize is not available via raw Bun primitives, that limitation must be recorded as a design constraint rather than hidden.

## Validation evidence

All spike outputs should be captured under:

```text
storage/artifacts/validation/<run-id>/
```

Expected evidence:

- Bun bootstrap response output
- Codex detection JSON
- raw app-server transcript JSONL
- thread start / resume evidence
- terminal viability output
- spike findings memo

## Completion rule

M0 is only complete when:

- spike code exists
- validation has been executed
- evidence paths are recorded
- findings have been written down with explicit constraints for M1+
