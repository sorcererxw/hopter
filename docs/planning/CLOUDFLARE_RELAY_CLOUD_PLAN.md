<!-- /autoplan restore point: local gstack project artifact -->
# Cloudflare Relay Cloud Plan

## Status

- status: proposed
- owner: product + platform
- scope: managed relay service for remote access to a local `hopter` host
- source: user request on 2026-04-23

## Why This Plan Exists

`hopter` already solves the same-machine, same-session control-plane loop.

What it does not yet solve is the boring but important thing users actually feel:
they leave home, open a phone or another laptop, and the host is still running,
but localhost is trapped on the wrong side of the network.

The user request is to add a **closed-source hosted relay** on Cloudflare that:

1. gives the user a hosted account and management page
2. lets the local `hopter` host opt into a managed relay session
3. assigns a stable hosted subdomain
4. forwards remote browser traffic back to the user's local `hopter` instance
5. keeps the cloud service operationally and legally separate from the open repo
6. still lets AI development stay smooth instead of turning this into repo hell

## Product Boundary

This plan intentionally keeps the existing product truth model intact.

### Open-source core remains

- local `hopter` daemon
- local project/session truth
- Codex integration
- local session history and artifacts
- local validation evidence

### Closed-source cloud owns

- hosted login
- account and host registry
- hosted subdomain allocation
- relay session brokering
- public edge ingress
- metering, quotas, and later billing

### Explicit non-goal

The hosted service must **not** become a second persistent source of truth for
Codex session history. It may cache routing, auth, and health state. It must not
mirror full transcripts or artifacts just because the cloud is available.

## The Narrow Wedge

Ship the smallest thing that makes the remote access loop real:

- one signed-in user
- one local host connected at a time
- one hosted subdomain
- browser access to the existing `hopter` web app only
- outbound-only host connector
- no generic shell
- no multi-project ACL editor
- no vanity domains in v1
- no team sharing in v1
- no multi-port service exposure in v1

If this first cut works, the user can leave the house, open `https://<slug>.hopter.app`,
log in, and continue the same local `hopter` workspace from anywhere.

That is the whole game.

## User Journeys

### Journey 1: First-time setup

1. User opens hosted control plane at `https://app.hopter.app`.
2. User signs in with hosted account auth.
3. User creates or claims a host slot.
4. Hosted control plane shows a one-time device code or browser-based link flow.
5. User runs `hopter relay login` locally to bind the machine to that hosted account.
6. User runs `hopter relay up`.
7. Hosted control plane allocates a stable public hostname such as
   `copper-fox.hopter.app`.
8. Local host opens an outbound relay connection.
9. Hosted dashboard shows host status as online and healthy.

### Journey 2: Remote re-entry

1. User visits `https://copper-fox.hopter.app` from a phone or another laptop.
2. Edge verifies the browser auth session.
3. Hosted relay resolves the public hostname to the bound host.
4. Request is forwarded through the live host connector to local `hopter`.
5. The existing `hopter` workspace renders, backed by the real local machine.
6. User resumes the same project/session flow they would have had on localhost.

### Journey 3: Host offline or degraded

1. User visits the hosted hostname.
2. Hosted edge resolves the host but sees no active connector.
3. Browser gets an honest offline/degraded screen from the hosted service.
4. User can see last-seen time, reconnect guidance, and optional wake-up actions.
5. Browser does not hang forever pretending the local host is still there.

## Core Premises

1. Users want the **same local machine**, not a cloud replica, browser IDE, or
   new agent.
2. The first hosted value is easier remote access, not team collaboration.
3. The local host must connect outbound only. Requiring inbound firewall setup
   kills adoption.
4. The public repo should expose only the minimum client-side and local-host
   hooks needed to talk to the hosted product.
5. The hosted service will stay closed-source and deploy separately from the
   open repo.
6. AI productivity matters enough that repo boundaries must be designed on
   purpose instead of hand-waved.

## Product Decisions

### 1. Use a `hopter relay` subcommand, not a `--relay` startup flag

Initial user wording implied a `--relay` switch.

This plan recommends a subcommand family instead:

- `hopter relay login`
- `hopter relay up`
- `hopter relay down`
- `hopter relay status`

Why:

- relay is stateful, not a one-bit mode
- the user will need login, reconnect, inspect, and revoke flows
- explicit commands are easier to document and debug than hidden flags

### 2. Keep remote browser traffic HTTP/WebSocket only

The relay exposes the existing browser workspace. It does not expose arbitrary
TCP forwarding and it does not expose a generic machine shell.

### 3. Keep the local browser API unchanged

The browser still talks to `hopter`.

Locally that is `http://127.0.0.1:<port>`.
Remotely that becomes the hosted relay hostname.

The UI should not need to know or care whether it is local or remote.

### 4. Separate repos, one local workspace

Do **not** force public and private code into one git repo just to make AI happy.

Instead:

- keep the public repo for local `hopter`
- keep the hosted service in a private repo
- develop them inside one parent workspace on the maintainer machine

Example local workspace:

```text
~/src/hopter-dev/
  /hopter           # public repo
  /hopter-cloud     # private repo
  /contracts        # optional shared contract package or generated SDK output
```

AI can operate from the parent workspace when a change spans both repos. Git
history, licensing, and deployment boundaries stay clean.

That is a better trade than pretending one git repo solves a product boundary.

## Architecture Options

### Option A: Cloudflare Tunnel as the data plane, hosted app as control plane

Shape:

- hosted dashboard + API run on Cloudflare
- local `hopter relay up` acquires tunnel credentials from the hosted service
- local machine runs an embedded or managed `cloudflared` process
- public subdomain maps to that tunnel

Pros:

- fastest time to market
- outbound-only by default
- Cloudflare already solves ingress routing and long-lived tunnel plumbing
- less protocol invention in the open repo

Cons:

- adds dependency on `cloudflared` lifecycle
- weaker product control over request brokering
- debugging spans our code plus Cloudflare tunnel semantics
- future multi-tenant policy and product logic sit on top of someone else's tunnel model

### Option B: Custom HTTP/WebSocket relay over Workers + Durable Objects

Shape:

- hosted Worker owns public hostname routing
- Durable Object owns live connector registry per host
- local `hopter relay up` opens persistent outbound WebSocket(s) to the relay edge
- remote HTTP/WebSocket browser requests are multiplexed through that connector

Pros:

- single product-owned relay protocol
- no extra host daemon beyond `hopter`
- easier to shape exact auth, quotas, and product semantics
- clean future fit for host attention, push, and session-aware routing

Cons:

- more engineering work now
- request streaming, flow control, and reconnect semantics become our problem
- harder first launch than using Cloudflare Tunnel

### Option C: Full custom reverse proxy stack outside Cloudflare primitives

Rejected.

That is a good way to spend months building infrastructure instead of shipping
the feature users asked for.

## Recommended Architecture

Recommend **Option A first**, with an explicit migration seam toward Option B if
Cloudflare Tunnel proves too limiting.

Why this is the right v1:

- the user need is remote access, not tunnel innovation
- outbound-only setup matters more than protocol purity
- Cloudflare already provides the hard part, public ingress over a durable edge
- we can keep the public repo thin and focused on local-host behavior

This is the pragmatic lake to boil.

## Proposed Cloudflare Stack

### Hosted edge and dashboard

- Cloudflare Workers for the hosted web app and API
- one zone such as `hopter.app`
- wildcard public hostname strategy such as `*.hopter.app`
- durable session cookies for browser auth

### Hosted control-plane state

- Cloudflare Durable Objects for live host connection presence, brokered routing,
  and per-host in-memory coordination
- Cloudflare D1 or Durable Object durable storage for account, host, slug, and
  lease metadata

### Optional later additions

- Cloudflare Queues for deferred host events and email jobs
- R2 for hosted screenshots or low-sensitivity evidence bundles
- Workers Analytics Engine or logs pipeline for relay health analytics

### What not to store in cloud

- full Codex transcript mirror
- full artifact mirror by default
- arbitrary repo contents
- generic remote shell output

## Auth Model

### Browser auth

Use standard hosted account auth with short-lived session cookies.

Do not invent bespoke auth crypto in v1. Use a normal OIDC-backed sign-in flow
or a hosted auth provider that runs cleanly on Workers.

### Host auth

Use a device-code or one-time enrollment flow:

1. user signs into hosted dashboard
2. dashboard creates short-lived enrollment code
3. local `hopter relay login` exchanges the code for host credentials
4. host stores a revocable relay credential locally

### Request auth at the relay edge

Every remote browser request must prove both:

- browser is signed into the hosted account
- requested hostname belongs to a host that account may access

### Revocation

Hosted dashboard must support:

- revoke host credential
- rotate hostname
- disable relay temporarily
- list last-seen connector time

## Public Routing Model

### Public hostnames

Initial format:

```text
https://<slug>.hopter.app
```

Rules:

- slug is stable per host unless user rotates it
- slug must be human-acceptable but not user-supplied freeform in v1
- reserve vanity custom domains for later

### Route behavior

- `app.hopter.app` is the hosted management app
- `<slug>.hopter.app` is the relay ingress hostname
- unknown slug returns hosted 404
- known but offline slug returns hosted offline state
- known and online slug proxies through the active connector

## Local Host Changes In The Public Repo

The public repo needs a thin relay client lane, not a hosted-service rewrite.

### New surfaces in `hopter`

1. CLI
   - add `hopter relay login`
   - add `hopter relay up`
   - add `hopter relay down`
   - add `hopter relay status`

2. Config
   - local relay enrollment credential
   - relay enabled/disabled state
   - last known public hostname
   - hosted base URL

3. Runtime
   - relay connector process manager
   - health/status integration into existing host status
   - graceful fallback to localhost-only mode

4. UI
   - settings/status surface that shows relay enrollment and current hostname
   - remote/offline truth in the host status area

### Explicitly out of scope in the public repo

- hosted user tables
- billing
- relay edge routing logic
- SaaS admin dashboard internals

## Private Cloud Repo Responsibilities

The private repo, tentatively `hopter-cloud`, owns:

- hosted web UI
- browser auth
- host enrollment API
- Cloudflare resource provisioning
- hostname registry
- tunnel credential issuance
- relay health model
- audit logs and later billing

Suggested shape:

```text
/apps/web
/apps/api
/packages/auth
/packages/relay-control
/packages/cloudflare
/packages/contracts
```

## Shared Contract Strategy

This is where teams usually create pain for themselves.

Recommended rule:

- keep the **minimum shared contract** versioned and explicit
- generate clients from that contract
- do not hand-copy DTOs between repos

Good candidates for shared contracts:

- host enrollment request/response
- relay status schema
- relay health events
- hostname assignment payloads

Implementation choices:

### Choice 1: tiny shared repo

- `hopter-relay-contracts`
- versioned schemas + generated clients

### Choice 2: contract package published from private repo

- public repo consumes generated SDK through package manager

### Choice 3: copy-paste JSON

Rejected.

That is how you end up spending Saturday night debugging one missing field.

## One-Workspace Development Flow

The user explicitly wants AI to work smoothly.

The right abstraction is **one workspace**, not one git repo.

### Recommended daily layout

```text
~/src/hopter-dev/
  /hopter
  /hopter-cloud
  /.envrc
  /Makefile
```

### Workspace commands

```bash
make dev-public
make dev-cloud
make dev-all
make test-public
make test-cloud
make test-contracts
```

### AI workflow

- open the parent workspace when a task spans both repos
- open a single repo when the task is isolated
- keep commit boundaries per repo
- keep cross-repo changes tied together by a shared task or plan doc

This preserves OSS/private separation without forcing humans or AI through a
broken context switch every ten minutes.

## System Flow Diagram

```text
Remote Browser
  -> https://<slug>.hopter.app
  -> Cloudflare edge
  -> hosted auth + slug lookup
  -> relay control plane
  -> outbound tunnel / connector
  -> local hopter HTTP server
  -> Codex app-server via local Go control plane
```

## State Ownership Diagram

```text
Local hopter:
  - projects
  - session refs
  - Codex orchestration
  - artifact metadata
  - local validation evidence

Hosted cloud:
  - users
  - hosts
  - enrollment credentials
  - public hostnames
  - relay presence
  - quotas / billing later
```

## Failure Modes Registry

| Failure | User Sees | System Behavior | Required Mitigation |
|---|---|---|---|
| Host offline | offline page | no proxy attempt | last-seen time + reconnect help |
| Tunnel token revoked | auth error in dashboard and CLI | connector exits cleanly | re-login flow |
| Hosted auth session expired | login prompt | no host traffic forwarded | short redirect loop must be avoided |
| Host connected to wrong account | hostname inaccessible | access denied | revocation + re-enroll |
| Slug collision | provisioning failure | host stays pending | server-side slug allocator |
| Cloudflare outage | degraded hosted page | local host unaffected | honest status page |
| Local hopter unhealthy | degraded proxy or 502 | relay stays connected but unhealthy | `/healthz` check gates routing |
| Browser websocket features break over relay | partial workspace failures | local host still running | explicit WS compatibility testing |

## Error And Rescue Registry

| Situation | Detection | Rescue |
|---|---|---|
| User enrolled host but never started relay | host has credential but no active connector | dashboard shows exact next command |
| User rotated slug accidentally | old hostname requested | hosted page links to management app |
| User uninstalls or upgrades local hopter | connector version mismatch | hosted API rejects incompatible client with upgrade message |
| Local network changes | connector reconnect loop | exponential backoff + visible status |
| Tunnel provider semantics change | relay health drops across fleet | private repo owns provider adapter and rollout controls |

## Security Rules

1. No inbound port opening required on the user's router.
2. No unauthenticated public hostname access.
3. No generic shell, file browser, or arbitrary TCP forwarding in v1.
4. Hosted service may know that a host exists and is online; it should not ingest
   arbitrary repo content by default.
5. Public repo must never hardcode privileged hosted secrets.
6. Host credential must be revocable without touching local Codex data.
7. Hostname ownership checks happen on every routed request, not just at login time.

## Implementation Phases

### Phase 0: Contract and workspace bootstrap

- define hosted/local boundary
- create shared contract package
- create parent workspace dev scripts
- add public repo config placeholders behind feature flag

### Phase 1: Hosted management MVP

- hosted login
- host enrollment flow
- host registry
- hostname allocation
- online/offline dashboard states

### Phase 2: Local relay MVP

- `hopter relay login`
- `hopter relay up`
- local credential persistence
- connector lifecycle supervision
- hostname/status reporting in CLI

### Phase 3: Public ingress

- public `<slug>.hopter.app` routing
- auth guard
- forward browser traffic to live host
- offline/degraded UX

### Phase 4: Product hardening

- revoke/rotate flows
- version compatibility checks
- retry/backoff polish
- analytics and support instrumentation

### Phase 5: Later monetizable upgrades

- vanity domains
- team sharing and RBAC
- usage tiers and billing
- push notifications
- multi-host org view

## Validation Plan

### Public repo validation

- CLI enrollment flow works locally against staging cloud
- relay status is visible in settings and/or host status
- remote access does not change local session truth
- remote browser can create/resume a normal `hopter` session through the relay

### Private repo validation

- hosted login and cookie flow
- slug allocation and collision handling
- host enrollment and revocation
- online/offline state truthfulness
- relay edge forwards browser HTTP and websocket traffic correctly

### End-to-end proof

1. Start `hopter` on a home machine.
2. Enroll host into hosted relay.
3. Start relay.
4. Visit hosted hostname from another network.
5. Resume a real Codex-backed session.
6. Create or continue work from the remote browser.
7. Capture evidence that the local host remained the source of truth.

## What Is Not In Scope

- making relay a prerequisite for core open-source value
- building a generic cloud IDE
- syncing full local files into the cloud
- multi-tenant enterprise admin
- replacing Codex with hosted reasoning
- full custom relay protocol in v1 if Cloudflare Tunnel is sufficient

## Open Questions

1. Browser auth vendor: self-managed OIDC library vs hosted auth provider on Workers
2. Storage choice: D1 vs Durable Object durable state for account/host metadata
3. Tunnel control: embedded `cloudflared` binary vs external dependency contract
4. Remote websocket coverage: exactly which `hopter` browser features must be proven on day one
5. Contract packaging: tiny shared repo vs published SDK package

## Initial Recommendation

Build this as an **open-core local product plus private Cloudflare-managed relay**.

Keep the public repo thin.
Keep the hosted repo private.
Keep the developer experience unified through one parent workspace, not one fake
mega-repo.

That gets you a real business boundary without making development miserable.

## Autoplan Intake

### Plan summary

This plan adds a hosted Cloudflare-backed relay layer on top of the existing
local `hopter` control plane. The local host remains the execution source of
truth. The cloud adds login, host enrollment, public hostname routing, and relay
presence so a user can reopen the same local workspace from another network.

### Scope detection

- UI scope: **yes**
  - hosted management app
  - remote offline/degraded states
  - public hostname entry flow
  - local settings/host-status surface for relay status
- DX scope: **yes**
  - new CLI commands
  - host enrollment flow
  - shared contract/package decisions
  - multi-repo but one-workspace development workflow

Loaded review skills from disk:

- `plan-ceo-review`
- `plan-design-review`
- `plan-eng-review`
- `plan-devex-review`

## CEO Review

### Step 0A: Premise Challenge

#### Is this the right problem to solve?

Yes, with one correction.

The right problem is **remote continuity for the existing local product**.
The wrong problem would be "build a cloud version of hopter" or "build a
general browser IDE."

This matters because the pain is not lack of compute. The pain is that the user's
real machine, real repo, and real Codex state are marooned on localhost.

#### What is the actual user and business outcome?

User outcome:

- leave the machine
- reopen the same local workspace from anywhere
- without hand-rolling Tailscale, reverse proxies, or SSH gymnastics

Business outcome:

- add a real paid wedge that open-source localhost mode cannot deliver alone
- keep the open-core story honest
- avoid turning the hosted product into a second source of product truth

#### What if we did nothing?

If we do nothing:

- advanced users keep using Tailscale, Cloudflare Tunnel, or DIY reverse proxies
- less technical users bounce because the last-mile remote access setup is the
  annoying part
- `hopter` stays useful but leaves the easiest monetizable wedge on the table

Conclusion:

The problem is real. The framing needs discipline. We are solving **hosted remote
access for a local product**, not inventing a new cloud runtime.

### Step 0B: Existing Code Leverage

| Sub-problem | Existing code / plan | Reuse decision |
|---|---|---|
| Host health and browser-visible host state | `internal/rpc/host_service.go`, `ui/src/features/host/use-host-status.ts`, `docs/planning/SETTINGS_SURFACE_PLAN.md` | Reuse. Extend host status with relay enrollment/presence instead of creating a parallel host dashboard model. |
| Durable local config owned by Go | `internal/userconfig/service.go`, `internal/rpc/config_service.go`, `ui/src/features/config/use-config.ts` | Reuse. Add relay config to the same Go-owned config path instead of inventing a second local settings file. |
| Local auth placeholder and browser session contract | `internal/http/auth.go`, `ui/src/features/auth/use-auth.ts` | Reuse shape, not semantics. Remote hosted auth replaces localhost-only assumptions at the edge, but the browser auth status pattern already exists. |
| Workspace shell and remote browser target | `ui/src/routes/session-route.tsx`, `ui/src/routes/settings-route.tsx`, existing `/` and `/sessions/:sessionId` shell | Reuse fully. Relay should forward the same app, not create a separate remote UI. |
| Reconnect/update signaling | `internal/events/hub.go`, `ui/src/lib/sse/use-workspace-events.ts` | Reuse locally. Hosted layer should expose host online/offline truth, not fork the session-event model. |
| Settings surfacing | `docs/planning/SETTINGS_SURFACE_PLAN.md`, current settings route | Reuse. Add relay enrollment/status to settings and host status instead of inventing a new giant admin area inside the OSS UI. |

What already exists:

- Go-owned config persistence
- host status transport and UI query hooks
- browser auth status pattern
- session workspace shell
- SSE-driven UI freshness model

What does **not** already exist:

- hosted account system
- host enrollment and revocation
- public hostname allocator
- relay tunnel lifecycle
- public ingress auth and routing

### Step 0C: Dream State Mapping

```text
  CURRENT STATE                         THIS PLAN                         12-MONTH IDEAL
  localhost-only, self-hosted   --->    hosted relay + login      --->   open-core local product with
  control plane; remote use             + public hostname +               polished paid remote access,
  requires user-managed tunnel          one-command host connect          org controls, vanity domains,
  or VPN                                                                 analytics, and strong mobile re-entry
```

Dream state delta:

- This plan moves toward the 12-month ideal if the cloud stays a thin access and
  account layer.
- It moves away from the ideal if the cloud starts mirroring transcripts,
  artifacts, or business logic that belongs on the local host.

### Step 0C-bis: Implementation Alternatives

```text
APPROACH A: Managed Cloudflare Tunnel Control Plane
  Summary: Hosted service provisions and manages Cloudflare Tunnel usage while
           local `hopter relay` handles enrollment and tunnel lifecycle.
  Effort:  M
  Risk:    Med
  Pros:    Fastest route to outbound-only remote access
           Uses Cloudflare's existing ingress/tunnel plumbing
           Keeps public repo focused on host-side behavior
  Cons:    Depends on cloudflared lifecycle and provider semantics
           Less product-level control over the data plane
           Debugging spans our code plus Cloudflare tunnel behavior
  Reuses:  Existing host/config/settings shell, Cloudflare Tunnel product

APPROACH B: Custom Workers + Durable Objects Relay
  Summary: Build a product-owned relay protocol over Workers and Durable
           Objects, with local `hopter` as the only host-side daemon.
  Effort:  L
  Risk:    High
  Pros:    Full product control over routing, auth, and quotas
           No extra daemon beyond `hopter`
           Better long-term platform fit if relay becomes a core business layer
  Cons:    More protocol and reliability work now
           Harder first launch
           Higher risk of building infrastructure before proving demand
  Reuses:  Existing workspace app, host/config/status surfaces, Durable Objects

APPROACH C: Hosted Dashboard + User-Managed Tunnel
  Summary: Ship hosted account management, but make the user bring their own
           tunnel/reverse proxy and just register the hostname with us.
  Effort:  S
  Risk:    Med
  Pros:    Smallest hosted build
           Minimal public-repo changes
           Lowest immediate infrastructure complexity
  Cons:    Weakest product experience
           Fails the "easy remote access" promise for less technical users
           Hard to monetize because the hard part is still on the user
  Reuses:  Existing self-hosted posture and user-managed remote access patterns
```

**Recommendation:** Choose **Approach A** because it delivers the user outcome with
the least custom infrastructure while preserving a migration seam to Approach B.

### Step 0D: Mode-Specific Analysis

Mode selected by autoplan: **SELECTIVE EXPANSION**

#### Complexity check

This feature is inherently cross-boundary:

- public repo host changes
- private cloud repo
- auth
- hostname routing
- tunnel lifecycle
- remote browser UX

That is already more than 8 files and more than 2 services. Smell confirmed.
The answer is not to pretend the complexity is small. The answer is to keep the
first shipped scope brutally narrow.

#### Minimum set of changes that achieves the goal

1. Hosted login and host enrollment
2. Stable public hostname per host
3. Outbound-only host connector
4. Public ingress auth + routing
5. Local relay status in CLI and settings
6. Honest offline/degraded experience

#### Accepted scope

- `hopter relay` command family instead of a single startup flag
- relay status in local settings/host status
- explicit offline/degraded hosted page
- version compatibility check between local host and hosted control plane
- one parent workspace flow for cross-repo AI/human development

#### Deferred to TODOS.md

- vanity domains
- team sharing / RBAC
- multi-port exposure
- billing and metering
- push notifications
- deep relay analytics

#### Platform potential

If this works, it becomes the base for:

- mobile re-entry
- host presence and notifications
- account-scoped org controls later

But those are **later**. The first release is remote continuity.

### Step 0E: Temporal Interrogation

```text
  HOUR 1 (human) / first 5 min (CC):
    Decide repo boundary, contract strategy, and auth ownership now.

  HOUR 2-3 (human) / next 10-15 min (CC):
    Implementers will hit tunnel lifecycle questions immediately:
    embedded cloudflared vs external dependency, credential storage, reconnect policy.

  HOUR 4-5 (human) / next 10-15 min (CC):
    Integration surprises will be browser websocket compatibility, hostname
    routing truth, and version skew between host and cloud.

  HOUR 6+ (human) / final 10-20 min (CC):
    Teams will wish the plan had specified offline UX, revocation flow, and
    end-to-end staging validation before shipping.
```

Implementation decisions that must be resolved in the plan:

- one-workspace vs one-repo development model
- Cloudflare Tunnel first vs custom relay first
- host enrollment credential flow
- where relay status appears in the existing product
- what exact remote failure states the user sees

### Step 0F: Mode Confirmation

- Mode: **SELECTIVE EXPANSION**
- Chosen implementation approach: **Approach A**
- Why: complete enough to ship the product wedge, simple enough not to become a
  tunnel company on day one

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | Intake | Treat the feature as both UI scope and DX scope | Mechanical | Choose completeness | The plan adds a hosted dashboard, remote browser states, CLI commands, and workflow changes. Skipping either review would miss real risk. | Backend-only review |
| 2 | CEO | Frame the problem as hosted remote access for a local product, not a cloud clone | Mechanical | Explicit over clever | This preserves the repo's source-of-truth boundary and avoids cloud-mirror drift. | Cloud-hosted hopter replica |
| 3 | CEO | Recommend `hopter relay` command family over a `--relay` flag | Taste | Explicit over clever | Relay is stateful and needs login/status/down flows; a subcommand is clearer. | Hidden startup flag only |
| 4 | CEO | Recommend Approach A as the first implementation path | Taste | Pragmatic | It reaches the user outcome faster than a custom relay and preserves a migration seam. | Approach B first, Approach C as primary |
| 5 | CEO | Keep public and private code in separate repos but one parent workspace | User Challenge | DRY | This keeps licensing and deployment boundaries clean while still giving AI a unified work surface. | One git repo for both products |
