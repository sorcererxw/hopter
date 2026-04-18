# Terminal Capability Plan

## Status

Proposed implementation plan.

This document defines how `orchd` should add terminal capability without breaking the product's core shape:

- session-first
- Codex-first
- browser-first
- Go-first
- artifact-first before raw terminal output

## Goal

Add a terminal surface that lets the user inspect and steer the same local machine and project from another browser, while keeping terminal explicitly secondary to:

1. status
2. summary
3. attention
4. composer
5. artifacts
6. timeline

The terminal exists because users need it sometimes.
It must not become the product's organizing principle.

## Problem statement

Today the rebuilt stack already supports:

- project selection
- session creation and follow-up
- Codex-backed session state
- artifact surfaces
- Connect control-plane APIs
- SSE freshness updates

What is missing is the escape hatch for work that is easier to inspect manually:

- `git status`
- local logs
- test reruns
- build output
- environment inspection
- one-off shell commands in the same project context

The product gap is not "lack of another primary interface."
The gap is "no honest fallback when artifact-first surfaces are not enough."

## Non-goals

This plan does not do the following:

- turn `orchd` into a browser IDE
- make terminal the main page
- expose arbitrary remote hosts as first-class targets
- introduce SSH key management as a core product concept
- persist full terminal history as durable product truth
- provide file transfer, port forwarding, or SFTP workflows
- make browser <-> Codex communication direct
- bless running an interactive `codex` TUI inside the embedded terminal as a normal workflow

## Product constraints carried forward

These constraints already exist and remain non-negotiable:

1. Codex stays the source of truth for session content, history, approvals, and artifacts.
2. Browser never talks to Codex directly.
3. Go server is the only Codex client.
4. Connect remains the primary structured browser API.
5. SSE remains the primary control-plane freshness channel.
6. Terminal is a fallback tool, not the product narrative.

Implication:

The terminal must be modeled as a sibling capability to the session control plane, not as a replacement for it.

## Decision summary

### Recommended v1 design

Use a **gateway-owned local PTY** on the host machine, attached to a project, surfaced through:

- **Connect** for terminal lifecycle and metadata
- **SSE** for lightweight terminal-status freshness
- **WebSocket** for interactive terminal stream and resize/input control

The browser still talks only to the Go server.
The Go server spawns and manages the PTY locally.

### Recommendation in one sentence

Do **not** use SSH as the primary terminal protocol for v1, use a local PTY plus a thin gateway-owned WebSocket stream because the product wedge is "same machine, same project, same session context," not "remote shell to an arbitrary host."

## Why SSH is the wrong primary answer

SSH sounds tempting because it is a mature terminal protocol. In this product it creates the wrong center of gravity.

### What SSH would force us to add

- an SSH server lifecycle
- host key management
- user key or password management
- another auth and trust story separate from `orchd`
- PTY allocation behind SSH anyway
- browser-side SSH bridging because browsers do not speak SSH natively
- a second mental model: "am I in orchd or in the host's SSH service?"

That is a lot of machinery to rediscover the same local machine we already own.

### Product mismatch

`orchd` is not a remote shell product.
It is a remote control plane for an existing local coding environment.

SSH makes the terminal look like the product.
That is the opposite of the current UX rules.

### Architectural mismatch

SSH would create a second transport stack and a second trust boundary that do not help with:

- session summary
- approval handling
- artifact navigation
- session continuity

We would still need Connect, SSE, and the session model.
SSH does not reduce the core architecture. It adds a parallel one.

## Option analysis

| Option | What it is | Pros | Cons | Verdict |
|---|---|---|---|---|
| A. Local PTY + Connect + SSE + WebSocket | Go server spawns PTY locally and streams it to browser | matches product wedge, no extra host auth layer, keeps browser talking only to Go, easiest UX alignment | requires a small custom stream protocol | **Recommended** |
| B. SSH passthrough to localhost | Browser or gateway connects to an SSH daemon on the same machine | mature protocol, reuse SSH semantics | wrong product center, extra auth/key lifecycle, browser does not speak SSH natively, duplicated trust boundary | Reject |
| C. Embedded SSH server inside `orchd` | `orchd` becomes an SSH server | single binary story | makes `orchd` partly an SSH product, heavy implementation and security burden | Reject |
| D. Connect streaming only | stream terminal data over RPC | keeps one transport family | Connect is wrong for long-lived bidirectional terminal byte flow | Reject |
| E. SSE only | use server push only | simple server stream | no bidirectional input, no resize, cannot support interactive shell | Reject |

## Chosen architecture

## Resource model

Introduce a new resource: `TerminalSession`.

This resource is:

- always attached to a `project`
- optionally attached to a `session`
- ephemeral and gateway-owned
- not durable truth after gateway restart

This keeps the mental model honest:

- session answers "what is Codex doing?"
- terminal answers "what can I inspect or run manually right now?"

## Ownership model

`TerminalSession` belongs to the gateway, not to Codex.

That means `orchd` may store lightweight terminal metadata because this is gateway-owned state, unlike Codex transcript truth.

Allowed persistent fields:

- terminal id
- project id
- optional session id
- cwd
- shell command
- status
- created at
- last activity at
- exit code
- last attached client id

Not allowed as durable truth:

- full scrollback history
- reconstructed terminal state after restart
- pretending a dead PTY is resumable

### Live replay buffer

To make browser refresh and short disconnects actually usable, keep a small **in-memory replay buffer** per live terminal.

Recommended starting shape:

- last 128-256 KB of output
- dropped on gateway restart
- replayed on successful reattach before live streaming resumes

This is not durable history.
It is reconnect ergonomics.

## Backend design

### New packages

Recommended additions:

```text
/internal/terminal
  manager.go
  model.go
  pty_runtime.go
  stream_hub.go
  store.go

/internal/rpc
  terminal_service.go

/internal/http
  terminal_ws.go
```

### Core components

#### 1. `TerminalManager`

Responsibilities:

- create terminal sessions
- spawn PTYs
- track live attachment state
- apply input and resize messages
- close idle or exited sessions
- publish terminal lifecycle events

#### 2. `PTYRuntime`

Responsibilities:

- spawn the configured shell using project cwd
- allocate pseudo-terminal
- read output stream
- write input
- resize rows/cols
- terminate process cleanly

Implementation target:

- macOS/Linux: `github.com/creack/pty`

Windows remains out of scope for v1.

#### 3. `TerminalStore`

Responsibilities:

- persist lightweight terminal metadata
- mark live/degraded/exited state
- support reconnect lookup

Backed by the existing repo storage approach.
If there is tension between sqlite persistence and implementation speed, start with in-memory plus explicit degraded semantics, then persist metadata once the live loop is sound.

#### 4. `TerminalStreamHub`

Responsibilities:

- own active WebSocket attachments
- enforce single-writer semantics
- fan terminal output to attached client
- send control messages such as `ready`, `exit`, `error`, `taken_over`
- batch bursty output into small frames so one noisy command does not thrash the browser

### Lifecycle flow

#### Create flow

1. browser calls `CreateTerminalSession`
2. server validates project/session relationship
3. server resolves cwd
4. server spawns shell PTY
5. server records terminal metadata
6. server returns terminal id and WebSocket attach URL
7. browser opens terminal drawer and attaches

#### Attach/reconnect flow

1. browser calls `GetTerminalSession` or receives active terminal metadata on session detail
2. browser opens WebSocket attach URL
3. server checks terminal status
4. if terminal is live, server replays the recent in-memory buffer, then attach succeeds
5. if terminal has exited, browser gets read-only final state with exit code
6. if gateway restarted and PTY is gone, browser gets degraded state

#### Close flow

1. browser calls `CloseTerminalSession`
2. server sends `SIGHUP` or configured termination
3. PTY exits
4. metadata marked closed
5. SSE emits terminal-status refresh event

## Browser transport split

### Connect is for control plane

Use Connect RPCs for:

- create terminal
- fetch terminal metadata
- list terminals for a session or project if needed
- close terminal
- optionally mark takeover intent

### SSE is for freshness only

Use SSE events for:

- terminal created
- terminal attached/detached
- terminal exited
- terminal degraded

SSE is not the terminal stream.
It only tells the UI what to refresh.

### WebSocket is for interactive stream

Use a dedicated WebSocket endpoint for:

- user input
- resize
- terminal output
- exit/error/takeover control messages

This is the one justified exception to "Connect + SSE first" because terminal is intrinsically bidirectional and long-lived.

### Route namespace

Reserve explicit terminal routes early:

- `POST /rpc/orchd.v1.TerminalService/*`
- `GET /terminals/:terminalId/stream`

That keeps the route tree honest and avoids terminal transport leaking into generic app paths later.

## Stream protocol

Keep v1 explicit and boring.

Use JSON messages over WebSocket.

### Browser -> server

```json
{ "type": "input", "data": "git status\r" }
{ "type": "resize", "cols": 120, "rows": 32 }
{ "type": "ping" }
{ "type": "takeover" }
```

### Server -> browser

```json
{ "type": "ready", "terminalId": "term_123", "cols": 120, "rows": 32 }
{ "type": "output", "data": "On branch master\r\n" }
{ "type": "exit", "exitCode": 0 }
{ "type": "error", "message": "terminal no longer available" }
{ "type": "taken_over" }
{ "type": "pong" }
```

Why JSON and not a binary custom subprotocol:

- easier to debug
- easier to test
- fast enough for the product's fallback-terminal role
- matches the product rule of explicit over clever

If a later phase proves throughput pain with long-running TUIs, that is the moment to version the stream. Not before.

## IDL surface

The current IDL plan explicitly excludes terminal byte streams. Keep that rule.

Add a new `terminal.proto` for terminal control-plane metadata only.

### Proposed package

```text
/idl/orchd/v1/terminal.proto
```

### Proposed service

```proto
service TerminalService {
  rpc CreateTerminalSession(CreateTerminalSessionRequest) returns (CreateTerminalSessionResponse);
  rpc GetTerminalSession(GetTerminalSessionRequest) returns (GetTerminalSessionResponse);
  rpc CloseTerminalSession(CloseTerminalSessionRequest) returns (CloseTerminalSessionResponse);
}
```

### Proposed messages

```proto
message TerminalSession {
  string id = 1;
  string project_id = 2;
  optional string session_id = 3;
  string cwd = 4;
  string shell = 5;
  TerminalStatus status = 6;
  uint32 cols = 7;
  uint32 rows = 8;
  google.protobuf.Timestamp created_at = 9;
  google.protobuf.Timestamp last_activity_at = 10;
  optional int32 exit_code = 11;
  bool attached = 12;
}

enum TerminalStatus {
  TERMINAL_STATUS_UNSPECIFIED = 0;
  TERMINAL_STATUS_STARTING = 1;
  TERMINAL_STATUS_LIVE = 2;
  TERMINAL_STATUS_EXITED = 3;
  TERMINAL_STATUS_DEGRADED = 4;
  TERMINAL_STATUS_FAILED = 5;
}

message CreateTerminalSessionRequest {
  string project_id = 1;
  optional string session_id = 2;
  optional string relative_cwd = 3;
  optional uint32 cols = 4;
  optional uint32 rows = 5;
}

message CreateTerminalSessionResponse {
  TerminalSession terminal = 1;
  string attach_path = 2;
}
```

That keeps the proto boundary narrow.
The stream stays outside the proto contract, where it belongs.

## Session integration

Do not merge terminal transcript into the Codex session transcript.

That would blur two different truth domains:

- Codex conversation state
- host shell state

Instead:

- session detail may show whether an active terminal exists
- session detail may open the terminal drawer bound to that session's project
- terminal lifecycle events may refresh session detail metadata

The session remains the primary page.
The terminal remains a tool launched from that page.

## Frontend design

## Placement

### Desktop

Use a bottom drawer in the selected session pane.

Rules:

- closed by default
- last-used height remembered locally per browser
- default height around 320-420px
- resizable, but not dominant
- session summary, attention, composer, and artifacts remain visible before opening

### Phone

Do not force a tiny embedded terminal strip.

Use a full-height sheet launched from the overflow menu or terminal button.
It is still secondary, but the device needs space for touch interaction.

### Large touch screens

Use the desktop information architecture with touch-sized controls.

## UI components

Recommended additions:

```text
/ui/src/features/terminal
  terminal-drawer.tsx
  terminal-sheet.tsx
  terminal-status-badge.tsx
  use-terminal.ts
  terminal-stream.ts
```

### Rendering stack

Use:

- `xterm.js`
- `@xterm/addon-fit`

Why:

- proven browser terminal rendering
- resize support
- less custom terminal emulation work

Do not build a terminal renderer from scratch.

## UX rules

1. Terminal launch is available from the workspace topbar.
2. Terminal state is visible but not louder than session attention.
3. Terminal can reconnect within the same gateway lifetime.
4. If terminal is degraded, say so plainly.
5. If another browser takes over, the old browser gets a clear banner.

### Required copy quality

Examples:

- `Terminal disconnected. The shell process may still be running. Reconnect to continue.`
- `Terminal ended with exit code 1.`
- `This terminal was taken over from another browser.`
- `Gateway restarted. This terminal can’t be resumed, but the session and artifacts are still available.`

## Multi-device behavior

This product's wedge includes continuing work across devices.
That matters here.

### Recommended v1 policy

- one active writer at a time
- newest attachment may take over
- previous attachment becomes read-only and receives `taken_over`

Why not true multi-writer:

- harder conflict model
- higher surprise factor
- not needed for the first useful version

This keeps cross-device continuity without pretending collaborative shell editing is simple.

## Security model

Terminal is the sharpest tool in the product.
Treat it accordingly.

### v1 security rules

1. only available on the same auth path as the rest of `orchd`
2. enforce same-origin and authenticated browser session checks
3. restrict cwd to:
   - project root, or
   - project-relative subpaths only
4. no arbitrary absolute path launch from the browser
5. inherit the project's local environment, but do not silently widen filesystem scope
6. close orphaned terminals after timeout when no client is attached

### Localhost dev mode

The repo already accepts localhost-only weak auth in dev.
That is acceptable for v1 local loop testing.

If non-local bind or relay arrives later, terminal must not ride along automatically.
It will require stronger auth review.

## Operational rules

### Default shell

Resolve in this order:

1. explicit configured shell for `orchd`
2. project/user environment shell
3. `/bin/zsh`
4. `/bin/bash`

### Default cwd

Resolve in this order:

1. requested project-relative cwd
2. session project root
3. project root

### Idle cleanup

Recommended initial policy:

- keep detached live terminal for 5 minutes
- then terminate unless marked pinned in a later phase

That supports temporary reconnect without accumulating dead shells forever.

## Failure modes and rescue plan

| Failure mode | User impact | Detection | Recovery |
|---|---|---|---|
| PTY spawn fails | terminal never opens | create RPC returns error | show actionable error, keep session usable |
| WebSocket attach fails | drawer shows no output | ws close/error | allow reconnect |
| Browser disconnects | user loses live view | missing client heartbeat | keep PTY for grace period |
| Second browser takes over | first browser loses control | attach collision | show read-only banner, explicit takeover |
| Gateway restart | PTY gone | missing runtime record | mark terminal degraded, do not fake resume |
| Invalid cwd request | security or confusion risk | create validation | reject with clear message |
| Terminal exits | command session ends | child process exit | show exit code and allow reopen |

## Interaction with Codex sessions

This is the sharp edge that can turn into a mess if we are sloppy.

### Explicit rule

The embedded terminal is **not** the blessed way to continue the same Codex conversation.

Why:

- `orchd` already owns the session control surface
- interactive `codex` inside terminal creates parallel state mutation
- the browser cannot know whether that shell activity changed the live Codex thread model

### v1 posture

Allow the terminal for:

- repo inspection
- tests
- build tools
- logs
- environment checks
- git commands

Do not design v1 around launching `codex` interactively inside it.
If users do it manually, treat that as unsupported power-user behavior, not first-class product flow.

## Execution plan

## Slice 1: IDL and backend metadata skeleton

Deliverables:

- `idl/orchd/v1/terminal.proto`
- generated Go and TS artifacts
- `TerminalService` Connect handlers
- terminal metadata store

Acceptance criteria:

- browser can create/get/close terminal metadata through Connect
- no stream yet required

## Slice 2: PTY runtime and WebSocket stream

Deliverables:

- `internal/terminal/pty_runtime.go`
- `internal/http/terminal_ws.go`
- live terminal manager

Acceptance criteria:

- create terminal
- attach WebSocket
- send input
- receive output
- resize works
- exit state recorded

## Slice 3: Session-detail terminal UI

Deliverables:

- desktop bottom drawer
- mobile terminal sheet
- topbar launch affordance
- terminal status badge

Acceptance criteria:

- session page can open terminal without displacing summary/artifacts
- reconnect behavior is visible and honest

## Slice 4: Reconnect, takeover, degraded semantics

Deliverables:

- reconnect grace period
- single-writer takeover policy
- degraded state after gateway restart
- SSE freshness events

Acceptance criteria:

- second browser can take over cleanly
- browser refresh can reattach within grace period
- gateway restart does not fake terminal recovery

## Slice 5: Validation and evidence

Deliverables:

- unit tests for runtime and manager
- integration tests for create/input/output/resize/exit
- browser validation script for session-detail terminal UX
- evidence bundle path recorded under `storage/artifacts/validation/`

Acceptance criteria:

- terminal path has evidence, not just implementation

## Validation plan

Add a dedicated validation lane:

```text
scripts/validate-go-terminal.ts
```

Evidence root:

```text
storage/artifacts/validation/terminal_<timestamp>/
```

Latest pointer:

```text
storage/artifacts/validation/latest-go-terminal.txt
```

### Required checks

#### Backend integration

- create terminal through Connect
- attach WebSocket
- send `pwd`
- confirm output contains project root
- resize terminal
- close terminal
- confirm exit/degraded metadata

#### Browser UX

- open selected session
- launch terminal from topbar
- verify drawer is secondary, not full page
- run a harmless command such as `printf "ok"`
- verify reconnect after page refresh
- verify takeover banner from second browser context

#### Negative tests

- reject absolute cwd outside project
- mark terminal degraded after server restart
- verify expired detached terminal is cleaned up

## What is intentionally deferred

- SSH backend adapters
- remote-host terminal support
- persistent scrollback replay
- collaborative multi-writer terminal sessions
- port forwarding
- file upload/download through terminal
- terminal search, bookmarks, and advanced shell tooling chrome

## Why this is the right scope

This plan gives users a real terminal when they need it.
It does not change what `orchd` fundamentally is.

The user still lands in:

- session state
- summary
- attention
- composer
- artifacts

Then, when raw shell access is the fastest path, the terminal is there.
Not before.

## Final recommendation

Build terminal support as a **project-scoped, optionally session-linked local PTY service** managed by the Go server, exposed with **Connect for lifecycle**, **SSE for freshness**, and **WebSocket for the live stream**.

Do not use SSH as the primary v1 protocol.

SSH is mature technology, but it solves the wrong center-of-gravity problem for `orchd`.
The product needs a thin, honest, same-machine terminal escape hatch, not a second remote access stack.
