# Product Memo

## Working Title

orchd

## One-line definition

A self-hosted gateway server that runs on the user's own machine, connects to existing coding agents, and exposes a web control plane that can be accessed from phone, laptop, or any browser.

## Open source baseline

- working project name: `orchd`
- v1 license target: `Apache-2.0`

## Problem

Today, remote coding with agent workflows breaks in two ways:

1. Existing hosted agent products often optimize for "send one prompt and let it run", not "plan first, confirm, then execute".
2. The real development environment only exists on the user's own machine or server, where repos, MCP servers, CLI tools, skills, secrets, and local conventions already live.
3. SSH is technically enough, but the product experience is bad, especially on mobile.

The job to be done is not "edit code on a phone". The job is:

"Use fragmented time to keep my real project moving forward on my own machine, with an agent that can explain what it will do and wait for approval when needed."

## Product shape

This product is not a new coding agent.

This product is also not just a chat wrapper around existing agents.

It is a control plane with a thin adapter layer:

- The user's machine runs a gateway server.
- The gateway connects to one or more existing coding agent backends.
- The gateway exposes a web UI.
- The user can access the UI from phone, work laptop, tablet, or desktop browser.
- The user manages bindings and backend sessions, not terminals.

## Core product principles

1. The user's machine is the source of execution truth.
2. Existing coding agents remain responsible for planning, reasoning, tool use, and execution.
3. The control plane is responsible for organization, visibility, approval, and remote access.
4. Backend-native semantics should be preserved as much as possible.
5. The system should be useful for one person on day one, while leaving room for future team and enterprise use.

## In scope for v1

- Self-hosted gateway server running on the user's own machine
- Browser-first UI, mobile-friendly
- Binding-based organization
- Backend sessions nested under bindings
- Codex as the primary backend
- Adapter framework that keeps future backend integrations cheap
- Remote access options:
  - local-only
  - user-managed reverse proxy
  - future managed relay/subdomain service

## Out of scope for v1

- Building a new coding agent
- Building a new planner or worker orchestration layer
- Replacing backend-specific agent logic
- Native iOS app
- Team permissions, SSO, enterprise policy, org-level audit features
- Autonomous binding-level backlog selection

## User experience model

### Primary information architecture

- Workspace
  - Bindings
    - Backend sessions

### Top-level navigation

The product should support both:

1. Binding-first navigation
   - users enter a binding, then inspect or start backend sessions

2. Attention-first overview
   - users see what currently needs action across all bindings

The core container is the binding. The dashboard is a cross-binding attention layer, not the primary data model.

## Delivery model

### 1. Gateway server

Runs on:

- a long-running Mac
- a Linux box
- Docker

Responsibilities:

- discover and connect to installed agent backends
- manage binding configuration
- create and resume backend sessions
- expose structured events to the web UI
- handle auth and optional remote exposure

### 2. Web UI

Accessible from:

- phone browser
- work laptop browser
- tablet browser
- desktop browser

Responsibilities:

- create backend sessions
- inspect plans and progress
- surface approval points
- display session checkpoints and artifacts
- allow attach/resume across devices

### 3. Optional managed relay

Future hosted service that gives users:

- account-based access
- tunnel / relay
- subdomain-based remote access

Example shape:

- user runs gateway locally
- gateway establishes outbound connection
- user opens `my-host.example.com`

This should be optional, not required for the open source product to function.

## Backend strategy

### v1 primary backend: Codex

Rationale:

- strongest fit with current user behavior
- first-party protocol and app-server support
- best starting point for building a control plane around session and approval workflows

### Adapter framework

The adapter framework should exist from day one, even if only one backend is implemented deeply in v1.

Why:

- avoids painting the product into a Codex-only corner
- keeps future integrations with Claude Code and OpenCode cheap
- forces the server/web contract to stay backend-agnostic at the right layer

### Future backends

- Claude Code
- OpenCode

The product should not assume all backends expose the same protocol depth.

Some backends will be richer and closer to "remote UI ready".
Others will require a thinner CLI or SDK adapter.

That is acceptable as long as the control plane contract stays small.

## Adapter framework principles

The adapter framework should abstract only the minimum common surface the control plane needs:

- binding creation
- backend session creation
- backend session attach/resume
- event stream
- user input / response
- approval handling
- stop / interrupt
- artifact access

It should not try to normalize how each backend thinks.

The backend remains the source of truth.
The adapter is a translator.
The control plane is an organizer.

## Why this is not "just UI"

The product is not just a skin because it also owns:

- binding organization
- remote backend session access
- backend attachment and discovery
- cross-device resume
- remote auth and exposure
- approval-centric interaction design

At the same time, it should avoid becoming a replacement agent runtime.

## Why this is not "build another agent"

That path is wrong for the product:

- too much scope
- duplicates mature backend capabilities
- weakens compatibility with users' existing tools
- turns a strong product wedge into an infrastructure rewrite

The value is not in replacing agent intelligence.
The value is in making existing agent workflows remote, visible, binding-aware, and phone-usable.

## Ideal v1 experience

1. User installs the gateway on their own machine.
2. The gateway detects Codex and offers to connect it.
3. The user adds one binding by selecting a repo.
4. The user opens the web UI from another device.
5. The user starts a backend session from that binding.
6. The backend plans and works using the user's existing machine environment.
7. The UI makes the process understandable and controllable without requiring terminal access.

## Product wedge

This product does not compete on "best coding model".

It competes on:

- best remote control plane for real local agent environments
- best plan-first remote coding workflow
- best cross-device continuity for coding backend sessions

## Future expansion

### Phase 2

- native iOS app
- push notifications
- better attention queue
- relay-based onboarding

### Phase 3

- team features
- hosted relay product
- org-level policy and auth
- enterprise deployment paths

## Open questions

1. How much of backend-native approval semantics can be preserved without inventing a second state machine?
2. What is the thinnest useful event contract for the control plane?
3. Which parts of remote access belong in the open source core versus hosted relay service?
4. How much backend-specific UI should be exposed versus hidden behind the control plane abstraction?

## Recommendation

Proceed with:

- a product/design pass first
- then a technical architecture pass
- then a codex-first prototype through the adapter framework

This keeps the product grounded in actual user value before implementation details start sprawling.
