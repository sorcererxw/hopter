# Design Doc

## Problem Statement

Remote coding with AI agents is broken in a very specific way.

The real working environment lives on the user's own machine:

- repos
- MCP servers
- CLI tools
- local configs
- secrets
- skills
- conventions

That machine is where real work can happen.

But the user is not always at that machine.

They leave home. They commute. They get to work. They still think about the same project. They still want the same agent to keep moving the project forward. Today the fallback is usually SSH, remote shell, or rebuilding the environment in the cloud.

That works technically. It is still the wrong product shape.

SSH is the right answer for remote shell.
It is not the right answer for remote agent workflow.

The user does not want to edit code on a phone. The user wants:

- the same agent
- the same project context
- the same workflow
- on their own machine
- from any device

The job to be done is:

"Let me keep my real project moving on my own machine, with the same coding agent and the same context, even when I am away from that machine."

## What Makes This Cool

The coolest version of this product is not "mobile coding".

It is:

**One agent, one project context, one workflow, continuous across devices.**

The wow moment is not that a phone can send a prompt.

The wow moment is:

- I start a coding session on my home machine
- I leave the house
- I open my phone and see the same session
- the same agent is still working in the same project context
- I approve the next step
- later I sit down at a different computer and resume the same session again

No SSH.
No cloud devbox migration.
No rebuilding the environment.
No losing the thread.

This matters because the real pain is not lack of compute access. The real pain is workflow interruption.

## Constraints

- The product should not become a new coding agent.
- The product should not replace backend-specific reasoning, planning, or orchestration.
- The product must work with the user's own machine as the execution environment.
- The product must be usable from browser first.
- Native iOS can come later, but it is not required for the core product to work.
- v1 should be real and daily-usable for one strong personal workflow, not broad and fake.

## Premises

1. The user's own machine is the best place to execute coding agent workflows because that is where the real environment already lives.
2. Existing coding agents are good enough to remain the execution and reasoning layer.
3. The missing product is a control plane, not another agent.
4. The narrowest useful first wedge is a solo developer with a long-running home machine doing side projects.
5. A browser-first control plane is enough to validate the product before building native mobile apps.
6. Codex is the right first backend because it matches the intended workflow and has strong protocol support.
7. The architecture should introduce an adapter framework from day one so future Claude Code and OpenCode integrations stay cheap.

## Cross-Model Perspective

Current feasibility evidence supports the product direction.

### Codex

Codex is the strongest v1 backend candidate:

- local CLI exists
- `app-server` exists
- `--remote` exists
- structured JSON execution output exists
- session resume exists
- approval and turn semantics exist in official app-server docs

This makes Codex suitable for a first-class integration.

### Claude Code

Claude Code appears viable as a future backend, but likely through a thinner adapter:

- headless execution exists
- JSON and stream-JSON output exist
- session resume exists
- SDK support exists

The likely difference is that Claude Code is better treated as a backend to adapt, not as a ready-made remote UI protocol.

### OpenCode

OpenCode is also promising:

- headless server support exists
- web mode exists
- attach/remote semantics exist
- API and event stream support exist

That makes OpenCode a strong future backend and a good proof point that the product category is real.

## Approaches Considered

### Approach A: Build a new coding agent with native multi-device workflow

This is the wrong move.

Why it is attractive:

- full control
- unified semantics
- no adapter complexity

Why it is wrong:

- scope explosion
- duplicates mature agent capabilities
- weakens compatibility with existing user environments
- delays the product by turning it into an infrastructure rewrite

This solves the wrong problem first.

### Approach B: Pure UI wrapper over existing agents

This is closer, but still incomplete.

Why it is attractive:

- small scope
- easy to explain
- leverages existing tools

Why it is insufficient:

- it underestimates the server/gateway layer
- it ignores project organization and remote access
- it risks becoming a shallow chat shell instead of a real control plane

The product has to do more than render messages.

### Approach C: Self-hosted gateway server plus web control plane with thin backend adapters

This is the recommended approach.

Why it works:

- keeps execution on the user's own machine
- preserves existing backend intelligence
- creates a real product surface around projects and sessions
- works from browser first
- gives a clean path to future relay and native app layers
- keeps future backend expansion cheap

This is the right level of ownership.

## Recommended Approach

Build a self-hosted gateway server that runs on the user's own machine and exposes a browser-based control plane for existing coding agents.

Key decisions:

- The product is a control plane, not a new agent.
- The user's machine remains the source of execution truth.
- Projects are the main container.
- Sessions live inside projects.
- A top-level dashboard exists as an attention layer across projects.
- v1 backend is Codex.
- The adapter framework exists from day one.
- Future integrations include Claude Code and OpenCode.
- Remote access supports:
  - local-only
  - self-managed reverse proxy
  - later managed relay/subdomain service

## Narrowest Wedge

The first user is not "everyone who uses coding agents".

The first user is:

**A solo developer with a long-running home machine, using a local coding agent for side projects, who often leaves that machine but still wants the same agent, same context, and same workflow to continue across phone and other computers.**

Why this wedge is good:

- the problem is real and frequent
- the user already has the machine setup needed to adopt the product
- the user feels the pain of workflow interruption immediately
- the product can be validated without team features or enterprise complexity

This wedge is narrow enough to ship and broad enough to matter.

## v1 Product Shape

### Gateway server

Runs on:

- long-running Mac
- Linux machine
- Docker

Responsibilities:

- connect to installed coding agent backends
- manage project definitions
- create and resume sessions
- expose structured events to the web UI
- handle authentication and optional remote access

### Web UI

Accessible from:

- phone browser
- work laptop browser
- tablet browser
- desktop browser

Responsibilities:

- list projects
- show sessions within projects
- start a session
- display plan/progress/checkpoints
- support attach/resume across devices

### Managed relay, later

Optional hosted layer that gives users:

- account login
- remote tunnel / relay
- subdomain access

This should make setup easier, but it should not be required for the open source core to function.

## v1 Minimum Viable Loop

This is the smallest version that the primary user would genuinely use:

1. User installs the gateway server on a home machine.
2. The gateway detects Codex and connects to it.
3. The user adds one project by selecting a repo.
4. The user opens the web UI from another device.
5. The user starts a session from that project.
6. The session runs on the home machine using the existing local environment.
7. The user can continue interacting with that session remotely from any browser.

That is enough.

If this loop works reliably, the product is already useful.

## Backend Strategy

### v1

- Codex as the primary backend
- adapter framework implemented from day one

### Why Codex first

- it matches the intended user workflow
- it has the strongest protocol surface for remote control
- it gives the best shot at building a real first-class control plane

### Future backend plan

- Claude Code as an adapter backend
- OpenCode as a future backend with strong server-native characteristics

The adapter layer should be intentionally thin:

- project binding
- session creation
- session resume/attach
- event stream
- user input/response
- approval handling
- interruption
- artifact access

The backend remains the source of truth.
The adapter translates.
The control plane organizes.

## Why This Is Better Than SSH

SSH solves command access.

This product solves:

- continuity of work context
- project-aware session organization
- remote visibility into what the agent is doing
- browser-first interaction from weak devices
- approval and control without terminal friction

The difference is not "GUI instead of terminal" as a cosmetic preference.

The difference is that agent workflows deserve a first-class control surface, just like traditional computing eventually moved from pure command lines to graphical systems for common tasks.

## Distribution Plan

### Open source core

The open source product should fully support:

- self-hosted gateway
- web UI
- Codex integration
- project and session organization
- local-only access
- self-managed reverse-proxy access
- Docker deployment

That is the trust base.

### Future hosted layer

The hosted layer can add:

- managed relay
- account-based access
- subdomains
- push notifications
- team and enterprise features later

This preserves a healthy open source core while keeping room for a 2B direction.

## Open Questions

1. What is the thinnest event contract the control plane needs without inventing a second agent truth?
2. How much backend-native UI should be preserved versus normalized?
3. Which relay/tunnel functionality belongs in the open source core versus hosted product?
4. What is the cleanest install path for personal Mac users:
   - desktop host app
   - CLI bootstrap
   - Docker first

## Success Criteria

v1 is successful if one real user can:

- run the gateway on their own machine
- connect Codex
- add a project
- leave that machine
- open a browser on another device
- continue the same project session remotely
- and prefer this flow over SSH for the same use case

The first success metric is not growth.
It is repeated personal use.

## Next Steps

1. Review this design doc for strategic and UX gaps.
2. Turn it into a technical architecture memo.
3. Define the adapter framework around Codex-first integration.
4. Build the minimal gateway plus web loop for one project and one backend.

## What I noticed about how you think

You have a strong instinct for where the real product boundary is.

You rejected several tempting wrong paths:

- "make a new agent"
- "just make a client"
- "just use SSH"
- "build the cloud version first"

That matters. A lot of builders get seduced by infrastructure gravity and spend months rebuilding what already exists.

What's interesting here is that you kept pulling the conversation back to the thing the user actually experiences:

- same workflow
- same agent
- same project
- no interruption

That is usually where the real product is hiding.

## Review-Guided Revisions

This section incorporates the first autoplan pass across product, design, engineering, and DX.

### Exact jobs where this beats SSH on day 1

The wedge is not "general remote development".

It is these specific jobs:

- approve or reject the next agent step during commute
- answer an agent clarification question from a phone
- inspect the latest session checkpoint, test result, or screenshot from a weak device
- resume the same session from a different computer without rebuilding the environment
- keep a side project moving while away from the home machine

This is where SSH is weak:

- bad mobile ergonomics
- poor visibility into agent state
- poor approval flow
- no project/session organization
- no productized cross-device continuity

### What "same context" means in v1

The original doc was too fuzzy here.

For v1, "same context" means these things survive across devices:

- backend session identity
- project binding
- repo binding
- worktree or branch reference
- conversation history relevant to that session
- pending approvals or pending questions
- artifact timeline, logs, screenshots, summaries, test output, changed-files list

It does **not** guarantee all of these in v1:

- full terminal scrollback fidelity
- raw environment variable replay in the UI
- arbitrary local desktop UI state
- exact reproduction of backend-internal private state that is not exposed by the backend

This sharpens the promise and keeps it honest.

### Revised v1 remote actions

The remote UX was underspecified. v1 should support these actions and no more:

- start a new session from a project
- view current plan or current checkpoint
- approve or reject a pending gate
- send a short steer or clarification reply
- interrupt, pause, or stop a running session
- resume or attach to an existing session
- inspect artifacts:
  - latest summary
  - changed-files list
  - test output
  - screenshots
  - log timeline

Explicitly out of scope for v1:

- deep file editing from phone
- arbitrary shell control
- full IDE-in-browser
- backend-agnostic normalization of every advanced feature
- multi-user concurrent editing semantics

### Security and trust model

Security is not a follow-up detail. It is part of the product definition.

#### Default mode

The gateway binds locally by default.
No public exposure by default.

#### Local-only mode

- localhost or LAN only
- local auth
- suitable for users who already use Tailscale, VPN, or direct local access

#### Self-managed remote mode

- user places the gateway behind their own reverse proxy or tunnel
- product documents the expected trust boundary
- product does not assume all reverse proxies are safe by default

#### Managed relay, later

- outbound-only connector from the host machine
- browser/app talks to relay
- relay talks to connected gateway
- gateway is not directly exposed to the public internet

#### v1 security rules

- per-project allowlist, not "all repos on this machine"
- backend actions only, no generic remote shell
- explicit remote session auth
- short-lived browser sessions
- device/session revocation support

### Reliability and source of truth

The product needs a clear answer to reconnect and event-loss questions.

For v1:

- backend session ID is the execution identity
- gateway event log is the UI rehydration source
- browser is always a client, never the source of session truth

If the browser disconnects:

- the session keeps running on the host if the backend supports it
- the browser rehydrates from gateway history on reconnect

If the gateway restarts:

- current session is marked degraded until it can re-attach or confirm final status
- the user must see that degraded state clearly

If machine sleep or CLI upgrade breaks continuity:

- surface the break honestly
- do not pretend the session is still healthy

### Revised backend strategy

The original phrasing overcommitted to a generic adapter framework too early.

The better sequencing is:

1. define a small adapter seam from day one
2. build the Codex loop first
3. extract only the abstractions proven necessary by the Codex loop

This keeps future backend expansion cheap without pretending the general framework is understood before the first backend works.

### Project versus session

Projects still remain the main container.

That said, the outside voice is right that forcing heavy project setup before value is a mistake.

So the revised rule is:

- projects are the durable organizational model
- the first-run flow is optimized for starting one session fast
- project creation happens as lightly as possible during repo selection
- dashboard views should foreground active sessions and pending attention

### Distribution path

The first install path should optimize for the actual wedge:

- Mac-first host flow for the side-project developer
- browser access from weak devices
- Docker supported, but not the primary onboarding

This avoids a 200-line config file to say hello world. Not great product design.

### Success metrics

The original success criteria were too soft.

v1 should track:

- time to first remote session
- time to approve the next step from a second device
- resumed-session success rate
- reconnect survival rate
- weekly repeat usage
- percentage of sessions where the user preferred this over SSH for the same task

## Information Architecture

If the user can only see three things on a weak device, they should be:

1. what needs attention now
2. what session is currently moving the project
3. how to jump back into a project quickly

### Screen hierarchy

```text
HOME / DASHBOARD
├── Needs Attention
├── Running Sessions
├── Recently Finished
└── Projects
    └── Project Detail
        ├── Sessions
        ├── Queue / Draft Ideas
        ├── Branches / Worktrees
        └── Settings
            ├── Host
            ├── Backend
            ├── Access
            └── Repo Permissions
```

### Navigation flow

```text
Phone / Browser
   │
   ├── Dashboard
   │     ├── Open pending approval
   │     └── Jump into running session
   │
   └── Project
         ├── Start session
         ├── Resume session
         └── Inspect prior artifacts
```

## Interaction State Coverage

```text
FEATURE                    | LOADING                       | EMPTY                                  | ERROR                                      | SUCCESS                             | PARTIAL
---------------------------|-------------------------------|----------------------------------------|--------------------------------------------|-------------------------------------|---------------------------------------------
Dashboard                  | Show host/session sync status | "No sessions yet" + start-session CTA  | Gateway unreachable / backend offline      | Attention queue visible             | Some projects load, one host degraded
Project list               | Skeleton project rows         | "No projects yet" + add-repo CTA       | Repo scan or permission failure            | Projects listed                     | Project metadata visible, status stale
Session detail             | Timeline skeleton             | "No events yet" for new session        | Session lost / event stream broken         | Plan, checkpoints, artifacts shown  | Old history available, live attach failed
Pending approval           | Loading current gate          | "Nothing waiting on you"               | Approval submit failed                     | Approval accepted and timeline moves| Gate visible, but backend health degraded
Artifact panel             | Loading summaries/screenshots | "No artifacts yet"                     | Artifact fetch failed                      | Tests/logs/screenshots visible      | Summary visible, file-level artifact missing
Remote attach/resume       | Reconnecting state            | "No resumable sessions"                | Session cannot be reattached               | Session live and controllable       | Read-only fallback after failed attach
```

## User Journey and Emotional Arc

```text
STEP | USER DOES                              | USER FEELS                     | PLAN SPECIFIES?
-----|-----------------------------------------|--------------------------------|----------------
1    | Installs host on home machine           | Hopeful, mildly suspicious     | Yes
2    | Connects Codex and one repo             | "Please don't be annoying"     | Yes
3    | Leaves home and opens phone             | Curious, wants quick success   | Yes
4    | Sees same session still alive           | Relief                         | Yes
5    | Approves next step from phone           | Control without friction       | Yes
6    | Returns on another computer and resumes | "Okay, this is real"           | Yes
7    | Uses it repeatedly instead of SSH       | Habit                          | Intended success metric
```

The emotional failure mode is obvious:

- if reconnect feels flaky
- if approvals are ambiguous
- if the browser cannot quickly answer "what is happening right now?"

the product collapses back into "I should have just used SSH."

## Responsive and Accessibility Requirements

The plan needs explicit mobile intent.

### Responsive rules

- phone first for session monitoring and approval
- tablet and desktop allow denser timelines and richer artifacts
- project and session summaries must be readable without horizontal scrolling
- action buttons must stay fixed or easy to reach on mobile for pending approvals

### Accessibility rules

- 44px minimum touch targets
- keyboard navigation for all core actions in browser UI
- landmarks for dashboard, project nav, session timeline, artifact panel
- approval dialogs fully screen-reader navigable
- session status never conveyed by color alone

## System Architecture

```text
                      OPTIONAL MANAGED RELAY
                    +-------------------------+
                    | Auth, tunnel, subdomain |
                    +-----------+-------------+
                                |
                                v
BROWSER / PWA  <------HTTPS/WS------->  GATEWAY SERVER  <------->  CODEX BACKEND
   |                                          |                         |
   |                                          |                         |
   |                                          v                         v
   |                                  Project/session store       Session / turn / events
   |                                          |                         |
   |                                          v                         |
   +--------------------Artifacts, checkpoints, approvals--------------+
                                                     |
                                                     v
                                               USER'S MACHINE
                                         repo, worktree, secrets, MCP
```

## Failure Modes Registry

```text
CODEPATH / AREA              | FAILURE MODE                                | RESCUED? | TEST? | USER SEES?                         | LOGGED?
-----------------------------|---------------------------------------------|----------|-------|------------------------------------|--------
Gateway startup              | Codex not detected                          | Y        | N     | Clear setup error                  | Y
Gateway startup              | Codex version incompatible                  | Y        | N     | Upgrade/downgrade guidance         | Y
Remote attach                | Browser disconnects                         | Y        | N     | Reconnecting, then rehydrated view | Y
Remote attach                | Gateway restarts mid-session                | Partial  | N     | Session marked degraded            | Y
Approval submit              | Backend rejects approval                    | Y        | N     | Retryable error                    | Y
Artifact fetch               | Screenshot/test artifact unavailable        | Y        | N     | Partial artifact view              | Y
Managed relay                | Relay unavailable                           | Partial  | N     | Host offline / relay degraded      | Y
Session resume               | Backend session cannot be reattached        | Partial  | N     | Read-only history + failed resume  | Y
```

Critical gaps before implementation:

- test coverage for reconnect and degraded-state behavior
- explicit auth model for browser and relay
- explicit codex-version compatibility policy

## What Already Exists

- Codex already provides the core execution intelligence
- Codex app-server already provides rich remote semantics
- user-managed reverse proxies and tunnels already exist
- browsers and PWAs already solve weak-device access well enough for v1

This plan should reuse those strengths instead of rebuilding them.

## NOT in Scope

- building a new coding agent, because that destroys the wedge
- full browser IDE, because the product is control-plane first
- deep mobile code editing, because the phone job is monitor/approve/steer
- generic remote shell, because SSH already owns that job
- fully generalized backend abstraction before Codex loop is proven
- team and enterprise features in v1, because the first user is solo
- native iOS in v1, because browser-first is enough to validate the loop

## Dream State Delta

```text
CURRENT STATE                    THIS PLAN                              12-MONTH IDEAL
SSH, tmux, cloud workarounds --> self-hosted Codex control plane  --> multi-backend, secure relay,
broken context continuity        for one real daily loop               native mobile, team-ready control plane
```

This plan moves in the right direction, but only if it stays narrow and survives the reliability/security work.

## DX Scorecard

```text
Dimension                 | Score | Notes
--------------------------|-------|---------------------------------------------------------
Getting Started           | 6/10  | strong shape, but install/bootstrap path needs sharper detail
API/CLI/SDK Design        | 7/10  | backend choice is sound, abstraction timing needed revision
Error Messages            | 5/10  | trust/degraded states were underspecified
Documentation             | 7/10  | problem and wedge are clear, v1 actions needed tightening
Upgrade Path              | 4/10  | CLI/backend upgrade compatibility not yet specified
Dev Environment           | 8/10  | own-machine execution is the right core bet
Community / OSS Fit       | 8/10  | open-source-first split is coherent
Measurement               | 5/10  | original success criteria were too soft, now improved
Overall DX                | 6/10  | promising, but first-run and failure-path clarity still matter
```

## Outside Voice Summary

Codex correctly pushed on these points:

- this product does own a control layer, even if it should not own agent reasoning
- security is central, not secondary
- "same context" needed an explicit definition
- the adapter framework should not be over-generalized before the Codex loop is proven
- the exact v1 jobs that beat SSH needed to be named

Codex also challenged the project-first structure. Current judgment:

- keep projects as the durable container
- but optimize first-run for fast session value, not heavy project administration

That remains the right compromise.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | CEO | Keep control-plane positioning, reject building a new agent | Mechanical | Focus | The wedge is workflow continuity, not agent intelligence | New agent runtime |
| 2 | CEO | Define exact day-1 jobs where this beats SSH | Mechanical | Specificity | The product wins only on concrete remote agent tasks | Generic "remote development" framing |
| 3 | Eng | Replace "general adapter framework first" with "Codex seam first, extract later" | User Challenge | Pragmatism | Premature abstraction would slow the only loop that matters | Overbuilt multi-backend abstraction |
| 4 | Eng | Make security/trust model part of the product definition | Mechanical | Completeness | Browser-exposed host software without a trust model is not shippable | Deferring security to implementation |
| 5 | Design | Keep projects as the organizational model, but foreground attention and fast session resume in UX | Taste | User empathy | This preserves long-term structure without making first-run feel heavy | Session-only top level |
| 6 | DX | Keep browser-first for v1, but define approval/steer as the primary mobile jobs | Mechanical | Constraint worship | Phone UX should optimize for the highest-frequency useful tasks | Deep mobile editing |

## Completion Summary

```text
+====================================================================+
|            AUTOPLAN REVIEW — COMPLETION SUMMARY                    |
+====================================================================+
| Mode selected        | SELECTIVE EXPANSION                          |
| CEO Review           | 4 major strategic gaps fixed                 |
| Design Review        | IA, state coverage, mobile intent added      |
| Eng Review           | Security, reliability, adapter timing fixed  |
| DX Review            | v1 actions and install path sharpened         |
| Outside voice        | Ran via Codex                                |
| Cross-model tension  | 1 meaningful tension: project-first vs session-first |
| NOT in scope         | written                                      |
| What already exists  | written                                      |
| Dream state delta    | written                                      |
| Failure modes        | written, 3 critical implementation gaps       |
| Lake Score           | 5/6 complete-option decisions                 |
+====================================================================+
```

## Approval Gate

Two decisions still deserve explicit approval before this becomes the working plan:

1. **Adapter sequencing**
   - recommendation: keep a narrow Codex-first seam, do not build a generalized adapter framework first

2. **Project/session UX balance**
   - recommendation: keep projects as the durable model, but make first-run and mobile use feel session-first and attention-first
