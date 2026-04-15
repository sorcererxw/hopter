# Communication And UX Spec

## Goal

Resolve the two most important product questions for v1:

1. how the gateway communicates with Codex and handles data
2. what the UI/UX should feel like on desktop and phone

This document is deliberately product-facing and protocol-facing at the same time.
It is not a full backend spec and not a visual design system.
It defines the shape of the product so implementation decisions stay aligned.

## Decision Summary

### Communication

- the browser never talks to Codex directly
- the gateway is the only Codex client
- the primary transport between gateway and Codex is local `stdio`
- the primary integration target is `codex app-server`
- `codex exec --json` is useful for spikes and fallback automation, but not the main control-plane protocol

### Data handling

- Codex remains the source of truth for session content and history
- the gateway stores only lightweight control-plane state plus validation evidence
- raw Codex protocol events may be sampled for debugging or validation, but are not the primary durable store
- frontend consumes gateway-owned state, not Codex protocol details
- artifacts are first-class objects, not just strings hidden in a log stream

### UX

- the product is a **remote agent control plane**
- it is not a chat wrapper
- it is not a browser IDE
- it is not a terminal-first shell
- the main product surface is the session detail page
- the main mobile jobs are: check status, approve, reply, interrupt, inspect artifacts

## Why `codex app-server` is the right integration target

Codex exposes two relevant integration surfaces:

1. `codex app-server`
2. `codex exec --json`

For this product, they should not be treated as equivalent.

### `codex app-server`

Best for:

- long-running sessions
- approvals
- structured agent events
- rich client integration
- attach or resume semantics

Why it matches the product:

- the product is session-centric
- approval handling is a first-class user action
- we need a stable notion of ongoing execution, not just command output
- we need a protocol client, not a process scraper

### `codex exec --json`

Best for:

- one-shot jobs
- automation
- CI
- small spikes
- fallback tasks where structured streaming is still useful

Why it is not the main product transport:

- it is shaped more like non-interactive execution
- it is weaker as the foundation for a persistent remote control plane
- it encourages treating agent output like logs instead of a live session protocol

## Transport Choice

The primary gateway-to-Codex transport in v1 should be:

```text
Gateway <-> Codex app-server over stdio
```

Not:

```text
Browser <-> Codex directly
Gateway <-> Codex over experimental remote WebSocket
Gateway scraping terminal text output
```

### Why `stdio`

- Codex is local to the user machine where the repo and credentials already live
- `stdio` keeps the trust boundary narrow
- it avoids extra network exposure inside the same host
- it avoids taking a v1 dependency on more experimental remote transport modes

### Gateway responsibilities at the protocol boundary

The gateway must:

1. spawn Codex app-server
2. maintain a request id map
3. decode incoming protocol messages
4. distinguish responses, notifications, and approval requests
5. translate protocol semantics into lightweight gateway state
6. optionally sample protocol traces for validation/debugging
7. expose a simpler event contract to the browser

## Communication Topology

```text
Browser
  |
  | HTTP + WebSocket
  v
Gateway
  |
  | JSON-RPC-like messages over stdio
  v
codex app-server
  |
  v
Codex runtime, tools, filesystem, MCP, credentials
```

## Data Model Layers

These layers must stay separate.

## Layer 1: Raw protocol events

This layer is the live protocol stream coming from Codex.
It may be sampled for debugging or validation, but v1 should not rely on it as a second durable source of session truth.

Examples:

- turn started
- turn completed
- message emitted
- command/tool/file operation event
- plan updated
- diff updated
- approval requested

Rules:

- not treated as the frontend's primary API
- sampled only where needed for debugging, validation, or short-lived cache
- never elevated above Codex as the source of truth

Why this matters:

- future Codex protocol changes are easier to absorb
- attach/recovery behavior can be debugged without inventing a second session database
- the gateway stays thin

## Layer 2: Gateway normalized state

This layer is the stable contract owned by the product.

Objects:

- `Project`
- `SessionRef`
- `ArtifactRef`
- `AttentionItem`
- `TerminalSession`

Rules:

- stable across backend protocol changes
- shaped for product logic, not protocol purity
- stored only as lightweight control-plane metadata where durability is actually needed

Examples of gateway-owned derived fields:

- `status`
- `attentionReason`
- `lastSummary`
- `degraded`
- `lastEventAt`

## Layer 3: UI view models

This layer is page-specific and can change with UX iteration.

Examples:

- dashboard attention cards
- session header state
- latest summary block
- artifact tabs with counts
- terminal drawer open/closed state

Rules:

- derived from normalized state plus UI state
- never persisted as system of record
- safe to redesign without protocol churn

## Data Pipeline

```text
Codex protocol message
  -> gateway translates live protocol state
  -> gateway updates lightweight session/attention references
  -> gateway emits UI-oriented websocket event
  -> frontend patches or refetches query state
```

This order is important.
The gateway should not emit browser updates that imply stronger guarantees than it currently has.

## Approval Handling

Approval is not "just another log line."

The gateway should model approval as a pending protocol request that requires a concrete response.

### Required approval flow

1. Codex emits an approval request
2. gateway records a pending attention item
3. gateway updates session status to `waiting_input`
4. gateway emits `session.attention.required`
5. UI shows a blocking action card
6. user chooses approve or reject
7. gateway replies to the exact pending protocol request
8. gateway clears or updates attention state based on result

### Product implication

The UI must not reduce approval to:

- a generic chat reply
- a plain note in timeline
- a best-effort "continue" button detached from protocol request identity

## Attach and Resume Policy

This needs a strict v1 boundary.

### v1 must support

- attach or resume for sessions created by the gateway

### v1 may support later

- adopting arbitrary Codex sessions created outside the gateway

Reason:

- external session adoption is useful, but it increases ambiguity around history, ownership, and recovery
- it should not delay the first reliable loop

The recovery model should therefore be:

- keep browser reconnect honest while the gateway process is alive
- ask Codex for live truth when reconnecting
- after gateway restart, avoid pretending the gateway has a recovered historical replica

## Artifact Strategy

Artifacts should be treated as first-class outputs.

They are the primary remote inspection surface after status and approval.

### v1 artifact types

- summary
- diff
- changed files
- test output
- screenshot
- log timeline chunks

### Product rule

The user should not need to scan raw event streams to understand progress.
The UI should foreground artifacts before logs.

## Browser Contract

The browser should not know:

- Codex protocol method names
- Codex request ids
- Codex event taxonomy in raw form

The browser should know:

- current session state
- whether attention is required
- what artifacts exist
- what actions are currently allowed
- whether live attachment is healthy

## UX Positioning

The product should feel like:

- a remote control plane for ongoing work
- a way to keep one persistent local coding environment productive across devices

The product should not feel like:

- a terminal emulator with extra chrome
- a file explorer with chat attached
- a generic AI messenger

## Primary Navigation Model

Top-level navigation should stay minimal:

- Sessions home
- Current session
- Settings

But the product should be biased toward direct session re-entry.

### Key principle

Repo context remains a real execution requirement.
Session is both the primary operational surface and the primary navigation surface.

So:

- dashboard should foreground active and recent sessions
- repo-context pages should exist, but as secondary utility surfaces
- session detail should be the page users live in

## Main User Jobs

### Phone

Primary jobs:

1. see what the agent is doing
2. approve the next step
3. answer one clarification
4. interrupt bad behavior
5. inspect latest summary, diff, tests, or screenshot

Not primary jobs:

- long-form code reading
- file editing
- deep terminal work

### Desktop

Primary jobs:

1. run and monitor multiple sessions
2. inspect artifacts in more depth
3. use terminal drawer when needed
4. recover from degraded states

## Page Structure

## Dashboard

Purpose:

- answer "what needs me right now?"

The dashboard should prioritize:

1. pending approvals/questions
2. running sessions
3. recent sessions worth re-entering
4. host health
5. repo-context utility actions

The dashboard should not default to:

- giant timeline dumps
- repo administration first

## Repo Context Detail

Purpose:

- secondary utility page for one stored local repo context

The repo-context page should show:

- context title and health
- sessions launched from this repo
- quick start session form
- context-level settings

The repo-context page should not become the main decision surface.
That is what session detail is for.

## Session Detail

This is the core product page.

The order matters.

### Session detail hierarchy

1. compact session header
2. conversation stream with latest summary and truth blocks
3. pending attention card
4. sticky composer
5. artifact surface
6. timeline
7. terminal drawer

### Why this order

- compact header answers "which session am I in?"
- conversation stream answers "what is it doing right now?"
- attention answers "what do you need from me?"
- sticky composer answers "what do I say back?"
- artifacts answer "what has it produced?"
- timeline answers "how did it get here?"
- terminal is fallback tooling, not the product's main narrative

## Session Detail Wireframe

### Mobile

```text
+--------------------------------------------------+
| Session title                         running    |
| last active 10s ago | Codex | host healthy       |
+--------------------------------------------------+
| Latest summary                                   |
| tracing reconnect handling, preparing diff       |
+--------------------------------------------------+
| Attention                                        |
| Approval required: allow edit in src/server      |
| [Approve] [Reject] [Reply] [Interrupt]           |
+--------------------------------------------------+
| Artifacts                                        |
| [Summary] [Diff] [Tests] [Shots] [Files]         |
| artifact viewer content                          |
+--------------------------------------------------+
| Timeline (collapsed by default)                  |
+--------------------------------------------------+
| Terminal                                         |
| Open drawer                                      |
+--------------------------------------------------+
```

Rules:

- action buttons stay near thumb reach
- timeline is collapsed or compact by default
- artifact tabs are more important than raw logs
- terminal is present but visually secondary

### Desktop

```text
+----------------------------------------------------------------------------------+
| Session title                          running | Codex | last active 10s ago     |
+--------------------------------------+-------------------------------------------+
| Left rail                            | Main pane                                  |
|                                      |                                           |
| Attention queue / quick nav          | Latest summary                             |
| Timeline                             | Pending attention card                     |
| Artifact list                        | Action bar                                 |
|                                      | Artifact viewer                            |
|                                      |                                           |
+--------------------------------------+-------------------------------------------+
| Bottom drawer: Terminal                                                           |
+----------------------------------------------------------------------------------+
```

Rules:

- desktop can show denser context
- summary and attention still stay visually dominant
- terminal remains a drawer, not the center pane

## Artifact-first UX

Remote usefulness depends more on artifacts than on logs.

The product should therefore optimize for:

- summary readability
- diff readability
- test failure readability
- screenshot visibility

Before it optimizes for:

- raw protocol trace readability
- shell-heavy workflows

## Timeline Philosophy

Timeline exists to explain state transitions, not to be the primary interface.

The default timeline behavior should be:

- visible enough to prove liveness
- compressed enough not to dominate the page
- expandable when deeper debugging is needed

## Terminal Philosophy

The terminal is allowed because users will need it sometimes.
The terminal is not the organizing principle of the product.

Rules:

- launch from current project cwd by default
- visually treat it as a drawer or sheet
- do not let it displace summary, attention, and artifacts
- do not market the product as "SSH with prettier UI"

## Error And Degraded UX

The user must be able to tell the difference between:

- still loading
- nothing here yet
- live and healthy
- degraded but history available
- fully failed
- backend unavailable

### Required copy quality

Error states should answer:

- what failed
- whether current displayed data is still trustworthy
- what action the user can take next

### Example

Good:

- "Live attachment to Codex was lost. Previous timeline and artifacts are still available."

Bad:

- "Something went wrong."

## UX Anti-goals

Do not build:

- file tree first navigation
- chat transcript as the entire product
- default full-screen terminal
- giant log wall as the session landing view
- mobile flows that require code reading before action

## V1 UX Success Criteria

We should consider the UX direction correct if a user can:

1. open the app on phone and know within seconds whether attention is needed
2. approve or reject without reading a raw event stream
3. inspect the latest useful output without opening the repo
4. understand degraded state honestly after reconnect or restart
5. use the same session from desktop later without context confusion

## Open UX Questions

These still need design iteration, but should stay within the boundaries above:

1. Should dashboard show running sessions and attention as separate lists or one prioritized queue?
2. How compact should mobile artifact tabs be before readability suffers?
3. Should session timeline default to grouped steps or a flat event list?
4. How much summary text should be shown before expanding to full artifact view?
