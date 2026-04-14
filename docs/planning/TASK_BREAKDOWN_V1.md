# Task Breakdown v1

## Goal

Break the current v1 plan into implementation-ready tickets for a Bun-first, Codex-first, self-hosted gateway product.

This document is optimized for actual execution:

- clear dependency order
- ticket-sized scope
- acceptance criteria
- rough PD estimate
- milestone grouping

The target is a serious personal alpha that can move toward OSS release.

## Planning Assumptions

- one strong full-stack engineer
- Bun-first runtime
- single-process monolith
- working name `orchd`
- Codex is the only deeply integrated backend in v1
- browser web app only
- terminal is secondary
- no native iOS app in v1

Validation is part of implementation.
Each milestone must produce evidence compatible with `docs/validation/VALIDATION_PROGRAM_V1.md`.

## Milestone Overview

| Milestone | Goal | PD |
|---|---|---:|
| M0 | prove Bun + Codex feasibility | 4-6 |
| M1 | gateway foundation and minimal control-plane persistence | 6-8 |
| M2 | Codex session loop | 8-10 |
| M3 | browser control plane | 8-10 |
| M4 | hardening and remote trustworthiness | 6-8 |
| M5 | tests, docs, release prep | 5-7 |

Planning total:

- **Serious alpha target:** `32-42 PD`

## Dependency Rules

Hard ordering:

1. M0 before meaningful implementation
2. DB and config before business services
3. project/session references before UI queries
4. Codex adapter before live session page
5. auth before any serious remote usage
6. degraded/reconnect handling before alpha claim

Soft ordering:

- dashboard can start before session detail is complete
- artifact viewer can trail session loop by a bit
- terminal drawer can land after main session UX

## Milestone 0: Bun + Codex Spike

Purpose:

- eliminate the largest technical unknowns before building product scaffolding

### T001: Bun runtime bootstrap spike

Scope:

- create minimal Bun server entry
- verify config loading and process boot shape
- confirm static file serving path is straightforward

Acceptance:

- one Bun process starts cleanly
- one HTTP route responds
- one static asset path can be served

Estimate:

- `0.5-1 PD`

Depends on:

- none

### T002: Codex detection and version spike

Scope:

- detect Codex binary
- capture version
- define compatibility check behavior

Acceptance:

- command path resolution works
- version is parsed into a structured object
- incompatible/missing states are distinguishable

Estimate:

- `0.5-1 PD`

Depends on:

- T001

### T003: Codex create-session spike

Scope:

- launch one Codex-backed session from Bun
- capture backend session id
- store raw event output to temp file

Acceptance:

- session launch works from Bun
- backend session id is captured
- raw event transcript is persisted

Estimate:

- `1-1.5 PD`

Depends on:

- T002

### T004: Codex attach/resume spike

Scope:

- attempt re-attach or resume from an existing session
- document limitations

Acceptance:

- attach/resume path is tested
- success/failure modes are written down
- gateway-facing contract is proposed

Estimate:

- `0.5-1 PD`

Depends on:

- T003

### T005: Bun terminal viability spike

Scope:

- test Bun terminal/process primitives on macOS
- verify interactive shell I/O, resize, close, cwd

Acceptance:

- shell launches in target cwd
- interactive input/output works
- resize works or limitation is documented
- close behavior is predictable

Estimate:

- `1-1.5 PD`

Depends on:

- T001

### T006: Spike findings memo

Scope:

- summarize what is proven
- summarize what is risky
- convert findings into implementation constraints

Acceptance:

- written note exists
- adapter seam decisions updated
- any blocked assumptions are called out explicitly

Estimate:

- `0.5 PD`

Depends on:

- T003
- T004
- T005

## Milestone 1: Gateway Foundation

Purpose:

- create the permanent local product skeleton

### T101: Repository skeleton

Scope:

- create `/src/server`, `/src/web`, `/src/shared`
- create bootstrap entrypoints
- wire Bun scripts

Acceptance:

- app boots in dev
- web build path is defined
- no fake package split

Estimate:

- `0.5-1 PD`

Depends on:

- T006

### T102: Config system

Scope:

- env parsing
- default values
- artifact path config
- auth config
- reverse proxy trust config

Acceptance:

- all required config has schema validation
- invalid config fails fast
- config object is centralized

Estimate:

- `0.5-1 PD`

Depends on:

- T101

### T103: Database bootstrap and migrations

Scope:

- initialize `bun:sqlite`
- add migration runner
- define first migration set

Acceptance:

- DB file is created automatically
- migrations run idempotently
- startup fails loudly on broken migration state

Estimate:

- `1 PD`

Depends on:

- T101

### T104: Base schema

Scope:

- create `projects`, `sessions`, `auth_sessions`, `terminal_sessions`

Acceptance:

- schema matches engineering spec
- indexes exist for primary query paths

Estimate:

- `0.5-1 PD`

Depends on:

- T103

### T105: Repository layer

Scope:

- implement raw repositories for core tables
- no business logic

Acceptance:

- repositories cover create/get/list/update paths needed by M1-M2
- repository tests exist for the main happy paths

Estimate:

- `1-1.5 PD`

Depends on:

- T104

### T106: Hono app and route mounting

Scope:

- mount API root
- mount auth middleware shell
- mount health routes
- mount SPA fallback and static asset serving

Acceptance:

- `/api/*` works
- frontend asset path works
- missing routes are cleanly handled

Estimate:

- `0.5-1 PD`

Depends on:

- T101
- T102

### T107: Host health service

Scope:

- implement host status model
- aggregate Codex detection + storage health

Acceptance:

- `/api/host/status` returns real values
- unhealthy states are explicit, not boolean-only

Estimate:

- `0.5-1 PD`

Depends on:

- T102
- T104

### T108: Backends API

Scope:

- implement `/api/backends`
- expose Codex availability and capabilities

Acceptance:

- browser can know whether Codex is available
- incompatible state is surfaced

Estimate:

- `0.5 PD`

Depends on:

- T107

### T109: Project CRUD API

Scope:

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`
- `PATCH /api/projects/:projectId`

Acceptance:

- repo path validation exists
- duplicate path rejection exists
- project detail returns health summary

Estimate:

- `1-1.5 PD`

Depends on:

- T105
- T106

### T110: Foundation docs

Scope:

- local boot instructions
- storage path explanation
- env var doc

Acceptance:

- fresh machine setup is documented

Estimate:

- `0.5 PD`

Depends on:

- T106

### T112: License and naming baseline

Scope:

- add `Apache-2.0` license choice to release baseline
- use `orchd` as project/package/app placeholder name consistently

Acceptance:

- public repo metadata no longer relies on placeholders

Estimate:

- `0.25-0.5 PD`

Depends on:

- T101

### T111: Validation harness foundation

Scope:

- define requirement-to-evidence matrix format
- define validation bundle output path
- add baseline validation script entrypoints

Acceptance:

- milestone work can attach evidence in a consistent structure
- validation outputs are not ad hoc console-only notes

Estimate:

- `0.5-1 PD`

Depends on:

- T101
- T102

## Milestone 2: Codex Session Loop

Purpose:

- make the gateway capable of creating, attaching, and controlling real sessions

### T201: Codex adapter core

Scope:

- adapter interface
- metadata function
- create session
- attach session

Acceptance:

- adapter API matches engineering spec
- session creation and attach return normalized values

Estimate:

- `1.5-2 PD`

Depends on:

- T006
- T105

### T202: Session service

Scope:

- create session record
- attach session record
- update session status
- derive attention state

Acceptance:

- service handles provisional states correctly
- service can mark degraded truthfully

Estimate:

- `1-1.5 PD`

Depends on:

- T105
- T201

### T203: Raw event ingestion

Scope:

- translate live backend events into lightweight session state
- update `last_event_at`
- optionally capture sampled traces for debugging and validation

Acceptance:

- session state updates correctly from live protocol messages
- sampled traces can be produced when needed for validation

Estimate:

- `1 PD`

Depends on:

- T201
- T202

### T204: Session APIs

Scope:

- `GET /api/projects/:projectId/sessions`
- `POST /api/projects/:projectId/sessions`
- `GET /api/sessions/:sessionId`
- `POST /api/sessions/:sessionId/attach`

Acceptance:

- browser can list project sessions
- browser can create a session
- browser can fetch session detail
- browser can request re-attach

Estimate:

- `1-1.5 PD`

Depends on:

- T202
- T203

### T205: Approval / input / interrupt APIs

Scope:

- `POST /api/sessions/:sessionId/input`
- `POST /api/sessions/:sessionId/approve`
- `POST /api/sessions/:sessionId/interrupt`

Acceptance:

- actions are forwarded to Codex
- optimistic lies are avoided
- failures surface actionable errors

Estimate:

- `1-1.5 PD`

Depends on:

- T201
- T202

### T206: Session summary derivation

Scope:

- derive latest summary field from backend events and/or artifact updates

Acceptance:

- dashboard and session detail can show a stable latest summary
- empty summary state is explicit

Estimate:

- `0.5-1 PD`

Depends on:

- T203

### T207: Artifact metadata ingestion

Scope:

- expose artifact references or fetch paths without creating a heavy local artifact mirror

Acceptance:

- session detail can list and open the latest useful outputs

Estimate:

- `1 PD`

Depends on:

- T203

### T208: Raw-to-normalized verification fixtures

Scope:

- create fixtures that prove raw Codex events map into normalized session, summary, and attention state

Acceptance:

- approval path fixture exists
- summary path fixture exists
- degraded path fixture exists

Estimate:

- `0.5-1 PD`

Depends on:

- T203
- T206

## Milestone 3: Browser Control Plane

Purpose:

- make the product actually usable from another device

### T301: Web app bootstrap

Scope:

- React app shell
- React Router tree
- Query client
- shared API client

Acceptance:

- browser app boots
- route navigation works
- API client is centralized

Estimate:

- `1 PD`

Depends on:

- T101
- T106

### T302: Auth screen and auth bootstrap

Scope:

- login page
- password input
- auth guard
- session bootstrap on refresh

Acceptance:

- unauthenticated users hit login page
- authenticated refresh restores session

Estimate:

- `0.5-1 PD`

Depends on:

- T301

### T312: PWA baseline

Scope:

- manifest
- installable metadata
- basic service worker strategy if needed for installability

Acceptance:

- app can be installed to home screen
- PWA shell does not interfere with live control-plane behavior

Estimate:

- `0.5-1 PD`

Depends on:

- T301

### T303: Dashboard page

Scope:

- host banner
- attention list
- running sessions
- recent sessions

Acceptance:

- dashboard answers "what needs me now?"
- empty and degraded states are present

Estimate:

- `1-1.5 PD`

Depends on:

- T107
- T204
- T301

### T304: Project create page

Scope:

- create-project form
- validation states

Acceptance:

- project can be created from the UI
- invalid repo path is visible

Estimate:

- `0.5-1 PD`

Depends on:

- T109
- T301

### T305: Project detail page

Scope:

- project header
- project health
- session list
- new session inline form

Acceptance:

- user can inspect one project's sessions
- user can start a new session from this page

Estimate:

- `1-1.5 PD`

Depends on:

- T204
- T301

### T306: WebSocket client and subscription model

Scope:

- socket connect
- reconnect
- subscription by page scope
- invalidate or patch Query cache

Acceptance:

- live updates reach dashboard/project/session pages
- reconnect falls back to HTTP refetch

Estimate:

- `1-1.5 PD`

Depends on:

- T204
- T301

### T307: Session detail page shell

Scope:

- session header
- status badge
- summary panel
- action bar
- timeline shell

Acceptance:

- session detail is usable before artifact viewer polish
- reconnecting/degraded/completed/failed states are visible

Estimate:

- `1.5-2 PD`

Depends on:

- T204
- T301
- T306

### T308: Attention card and action flows

Scope:

- approval needed card
- clarification needed card
- approve / reject / send input / interrupt UI

Acceptance:

- all main remote-control actions work from session page
- pending mutation states are clear

Estimate:

- `1-1.5 PD`

Depends on:

- T205
- T307

### T309: Artifact panel and viewers

Scope:

- artifact tabs
- text artifact viewer
- image artifact viewer
- changed files / diff viewer

Acceptance:

- user can inspect the latest useful outputs without opening raw files

Estimate:

- `1-1.5 PD`

Depends on:

- T207
- T307

### T310: Mobile optimization pass

Scope:

- mobile layout pass for dashboard, project, session
- thumb-friendly action placement
- compressed artifact presentation

Acceptance:

- primary remote jobs work on phone viewport

Estimate:

- `0.5-1 PD`

Depends on:

- T303
- T305
- T307
- T308

### T311: Session UX screenshot validation

Scope:

- capture desktop and mobile screenshots for dashboard and session detail
- assert the intended hierarchy remains visible

Acceptance:

- screenshot artifacts exist for milestone review
- major layout regressions are catchable

Estimate:

- `0.5-1 PD`

Depends on:

- T303
- T307
- T309

## Milestone 4: Hardening

Purpose:

- make the product honest and trustworthy in real remote use

### T401: Auth backend

Scope:

- auth session table usage
- cookie issue/revoke
- auth middleware

Acceptance:

- protected APIs reject anonymous calls
- logout revokes session cleanly

Estimate:

- `1 PD`

Depends on:

- T104
- T106

### T402: Reverse-proxy-safe deployment config

Scope:

- trusted proxy config
- forwarded headers handling
- cookie security mode

Acceptance:

- self-managed remote deployment is documented and technically supported

Estimate:

- `0.5-1 PD`

Depends on:

- T401

### T403: Degraded-state model

Scope:

- gateway restart handling
- backend lost handling
- stale action conflict handling

Acceptance:

- session states never imply liveness when unknown
- degraded state is visible in API and UI

Estimate:

- `1-1.5 PD`

Depends on:

- T202
- T203
- T306

### T404: Gateway restart recovery

Scope:

- boot-time session ref recovery
- attempt attach for known sessions when possible
- downgrade to degraded when not possible

Acceptance:

- restart does not erase session history
- restart recovery is predictable

Estimate:

- `1-1.5 PD`

Depends on:

- T203
- T204

### T405: Host health and compatibility polish

Scope:

- incompatible Codex handling
- missing Codex handling
- storage path health

Acceptance:

- settings and dashboard clearly explain unavailable backend states

Estimate:

- `0.5-1 PD`

Depends on:

- T107
- T108

### T406: Embedded terminal drawer

Scope:

- open shell session
- stream output
- send input
- resize
- close

Acceptance:

- terminal behaves like a useful drawer, not a broken demo
- cwd defaults to project repo

Estimate:

- `1.5-2 PD`

Depends on:

- T005
- T301

### T407: Security and failure UX pass

Scope:

- login failure UX
- expired session UX
- dangerous-state copy
- error message consistency

Acceptance:

- the product does not hide critical trust-boundary failures behind generic toasts

Estimate:

- `0.5-1 PD`

Depends on:

- T302
- T401
- T403

### T408: Degraded-state validation suite

Scope:

- simulate browser disconnect
- simulate gateway restart
- simulate lost live attachment
- verify UI and API truthfulness

Acceptance:

- degraded-state behavior is proven with repeatable checks

Estimate:

- `1 PD`

Depends on:

- T403
- T404

## Milestone 5: Tests, Docs, Release Prep

Purpose:

- make it publishable and maintainable

### T501: Unit test baseline

Scope:

- repositories
- config parsing
- session state transitions

Acceptance:

- high-value pure logic has tests

Estimate:

- `1 PD`

Depends on:

- T105
- T202

### T502: Integration tests

Scope:

- API + DB integration
- auth flow
- project CRUD
- session create path

Acceptance:

- major server flows are covered without a browser

Estimate:

- `1-1.5 PD`

Depends on:

- T401
- T204

### T503: E2E smoke flow

Scope:

- login
- create project
- create session
- inspect session page
- perform one action

Acceptance:

- one browser-driven happy path is automated

Estimate:

- `1-1.5 PD`

Depends on:

- T303
- T305
- T307
- T308

### T504: Install and deployment docs

Scope:

- Bun install
- local run
- long-running process mode
- reverse proxy example

Acceptance:

- a new user can get a local instance running from docs

Estimate:

- `0.5-1 PD`

Depends on:

- T402

### T505: Architecture and contributor docs

Scope:

- explain single-process shape
- explain Bun-first constraint
- explain adapter boundary
- explain storage layout

Acceptance:

- contributors can orient quickly

Estimate:

- `0.5-1 PD`

Depends on:

- T201
- T404

### T506: Release packaging

Scope:

- production build script
- release checklist
- first alpha tag plan

Acceptance:

- there is a repeatable release path

Estimate:

- `0.5-1 PD`

Depends on:

- T504

### T507: PRD acceptance matrix and evidence bundle

Scope:

- compile requirement-to-evidence matrix
- generate release validation bundle
- produce alpha readiness summary

Acceptance:

- release candidate has a reviewable validation package
- milestone claims are backed by evidence references

Estimate:

- `0.5-1 PD`

Depends on:

- T501
- T502
- T503
- T504

## Critical Path Tickets

These tickets determine whether the product is real or still a demo:

1. T003 Codex create-session spike
2. T005 Bun terminal viability spike
3. T103 database bootstrap and migrations
4. T201 Codex adapter core
5. T202 session service
6. T203 raw event ingestion
7. T204 session APIs
8. T306 WebSocket client and subscription model
9. T307 session detail page shell
10. T403 degraded-state model
11. T404 gateway restart recovery
12. T503 E2E smoke flow
13. T507 PRD acceptance matrix and evidence bundle

## Suggested First Sprint

If you want the shortest route to visible progress, the first sprint should be:

- T001
- T002
- T003
- T005
- T006
- T101
- T102
- T103
- T104
- T111

This gives you:

- runtime proof
- Codex proof
- Bun terminal proof
- permanent app skeleton
- real DB base
- baseline validation harness

That is the right foundation before touching polished UI.

## Suggested Second Sprint

- T105
- T106
- T107
- T108
- T109
- T201
- T202

This gives you:

- actual gateway backend shape
- project CRUD
- first real adapter and session service

## Suggested Third Sprint

- T203
- T204
- T205
- T206
- T301
- T302
- T303
- T305

This gives you:

- end-to-end session backbone
- first browser control plane

## Cuttable Scope If Needed

If schedule gets tight, cut in this order:

1. T406 embedded terminal drawer
2. T309 richer artifact viewers
3. T310 mobile polish depth
4. T505 contributor docs depth
5. T311 session UX screenshot validation

Do not cut:

- T003
- T201
- T202
- T203
- T204
- T306
- T307
- T403
- T404

If those are cut, the product stops being the thing we said we are building.

## Definition of Alpha Readiness

The alpha is ready when all of these are true:

1. user can install and boot the gateway on a personal machine
2. user can add a repo as a project
3. user can create and resume a Codex-backed session
4. user can remotely inspect status, summary, artifacts, and attention state
5. user can remotely approve, reject, interrupt, and send follow-up input
6. browser disconnect and gateway restart do not silently lose truth
7. login and reverse-proxy deployment are both documented
8. PRD validation evidence bundle exists
