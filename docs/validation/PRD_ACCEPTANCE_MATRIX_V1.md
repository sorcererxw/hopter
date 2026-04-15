# PRD Acceptance Matrix v1

## Goal

Provide an explicit requirement-to-evidence matrix that the implementation agent can use to verify completion.

This file is the practical bridge between:

- product intent
- implementation tickets
- validation evidence

The matrix should be updated as the product evolves, but v1 should start with a fixed baseline rather than asking the agent to invent its own acceptance criteria each time.

## Status Values

- `Not Started`
- `In Progress`
- `Needs Evidence`
- `Pass`
- `Fail`
- `Waived`

## Validation Methods

- `Static`
- `Unit`
- `Integration`
- `E2E`
- `Screenshot`
- `Manual Review`
- `Failure Simulation`

## Matrix

| Req ID | Source | Requirement | Validation | Evidence Path | Status |
|---|---|---|---|---|---|
| PRD-01 | DESIGN_DOC | User can install and boot the gateway on a personal machine | Integration + Manual Review | `storage/artifacts/validation/m0_2026-04-14T09-17-42-553Z`, `storage/artifacts/validation/m1_2026-04-14T09-18-53-875Z` | Pass |
| PRD-02 | DESIGN_DOC | Gateway detects Codex and surfaces incompatible or missing states clearly | Integration + Screenshot | `storage/artifacts/validation/m0_2026-04-14T09-17-42-553Z/t002/codex-detection.json`, `storage/artifacts/validation/latest-web-shell.txt` | Pass |
| PRD-03 | DESIGN_DOC | User can add a local repo as a project | E2E + Screenshot | `storage/artifacts/validation/m5_2026-04-14T09-45-51-719Z/screenshots/e2e-project-created.png`, `storage/artifacts/validation/latest-web-shell.txt` | Pass |
| PRD-04 | COMMUNICATION_AND_UX_SPEC | Browser never talks to Codex directly; gateway is the only Codex client | Static + Manual Review | `src/server/bootstrap/index.ts`, `src/server/bootstrap/create-fetch-handler.ts`, `src/server/services/backend-session-service.ts` | Pass |
| PRD-05 | COMMUNICATION_AND_UX_SPEC | Gateway uses `codex app-server` as the primary structured integration path | Integration + Manual Review | `storage/artifacts/validation/m0_2026-04-14T09-17-42-553Z/t003/raw-events.jsonl`, `src/server/adapters/codex/app-server-client.ts` | Pass |
| PRD-06 | COMMUNICATION_AND_UX_SPEC | Raw Codex events are preserved append-only and normalized into gateway-owned state | Unit + Integration | `storage/artifacts/validation/m2_2026-04-14T09-32-52-351Z/session/summary-artifacts.json`, `test/session-normalizer.test.ts` | Pass |
| PRD-07 | DESIGN_DOC | User can create a Codex-backed session from the web UI | E2E + Integration | `storage/artifacts/validation/m5_2026-04-14T09-45-51-719Z/screenshots/e2e-session-summary.png`, `storage/artifacts/validation/m2_2026-04-14T09-32-52-351Z/session/create-summary.json` | Pass |
| PRD-08 | COMMUNICATION_AND_UX_SPEC | Session detail prioritizes status, summary, attention, and artifacts over timeline and terminal | Screenshot + Manual Review | `storage/artifacts/validation/m3_2026-04-14T09-38-22-511Z/screenshots/session-desktop.png`, `storage/artifacts/validation/latest-web-shell.txt` | Pass |
| PRD-09 | DESIGN_DOC | User can remotely inspect current session status and latest useful output from another device context | E2E + Screenshot | `storage/artifacts/validation/m3_2026-04-14T09-38-22-511Z/screenshots/session-mobile.png`, `storage/artifacts/validation/latest-web-shell.txt` | Pass |
| PRD-10 | COMMUNICATION_AND_UX_SPEC | Approval is handled as a first-class pending request, not as a generic chat reply | Integration + E2E | `storage/artifacts/validation/m2_2026-04-14T09-32-52-351Z/approval/detail-pending.json`, `storage/artifacts/validation/latest-web-shell.txt` | Pass |
| PRD-11 | DESIGN_DOC | User can send follow-up input and interrupt a running session remotely | E2E + Integration | `storage/artifacts/validation/m5_2026-04-14T09-45-51-719Z/e2e/input-forwarded.json`, `storage/artifacts/validation/m5_2026-04-14T09-45-51-719Z/e2e/interrupt-forwarded.json` | Pass |
| PRD-12 | COMMUNICATION_AND_UX_SPEC | Artifact-first UX allows summary/diff/tests/screenshots to be inspected without opening the repo | E2E + Screenshot | `storage/artifacts/validation/m3_2026-04-14T09-38-22-511Z/session/summary-artifact-detail.json`, `storage/artifacts/validation/latest-web-shell.txt` | Pass |
| PRD-13 | DESIGN_DOC | Browser reconnect does not silently lose truth about current session state | Failure Simulation + E2E | `storage/artifacts/validation/m5_2026-04-14T09-45-51-719Z/screenshots/session-reconnecting.png`, `storage/artifacts/validation/m5_2026-04-14T09-45-51-719Z/screenshots/session-reconnected.png` | Pass |
| PRD-14 | ENGINEERING_SPEC_V1 | Gateway restart does not fabricate restored control-plane session state and keeps artifact evidence available | Failure Simulation + Integration | `storage/artifacts/validation/m4_2026-04-14T09-44-16-146Z/recovery/session-degraded.json`, `storage/artifacts/validation/m4_2026-04-14T09-44-16-146Z/screenshots/session-degraded.png` | Pending |
| PRD-15 | COMMUNICATION_AND_UX_SPEC | Mobile viewport supports the core jobs: check status, approve, reply, interrupt, inspect artifacts | Screenshot + E2E | `storage/artifacts/validation/m5_2026-04-14T09-45-51-719Z/screenshots/session-mobile-actions.png`, `storage/artifacts/validation/latest-web-shell.txt` | Pass |
| PRD-16 | DESIGN_DOC | Local-only and self-managed remote deployment are both supported and documented | Integration + Manual Review | `docs/operations/DEPLOYMENT.md`, `storage/artifacts/validation/m4_2026-04-14T09-44-16-146Z/auth/login-success.json` | Pass |
| PRD-17 | VALIDATION_PROGRAM_V1 | Release candidate produces a reviewable evidence bundle rather than only console output | Static + Manual Review | `storage/artifacts/validation/m5_2026-04-14T09-45-51-719Z/bundle/evidence-index.json`, `docs/operations/ALPHA_READINESS_SUMMARY.md` | Pass |

## Completion Rule

The implementation agent should not claim v1 completion unless:

- every non-waived row is `Pass`
- every `Pass` row has evidence
- no PRD-critical row remains `Needs Evidence`

PRD-critical rows for alpha:

- PRD-01
- PRD-02
- PRD-03
- PRD-06
- PRD-07
- PRD-09
- PRD-10
- PRD-11
- PRD-12
- PRD-13
- PRD-14
- PRD-15
- PRD-17

## Agent Operating Rule

When finishing any major task, the agent should:

1. identify impacted PRD rows
2. update their evidence path
3. run the required validation mode
4. change status only if evidence exists

No evidence, no pass.
