# Terminal Implementation Task List

## Status

Proposed execution checklist.

This task list operationalizes:

- [TERMINAL_CAPABILITY_PLAN.md](TERMINAL_CAPABILITY_PLAN.md)

## Goal

Ship a session-scoped browser terminal for `hopter` with these fixed product semantics:

- terminal identity is `browser_instance_id + tab_id + session_id`
- same-tab refresh may reattach
- different tab or different device never reuses the old terminal
- terminal is launched manually from session topbar
- terminal is drawer-first on desktop and large touch screens
- phone viewport hides the feature
- frontend renderer defaults to `wterm`

## Delivery checklist

Completion requires all of:

- requirement mapped
- implementation merged
- validation executed
- evidence path recorded

No evidence, no pass.

## Milestone T0 — Contract Lock

### T001 Confirm proto and route boundary

Produce:

- `idl/hopter/v1/terminal.proto`
- explicit HTTP route plan for terminal stream

Required decisions already locked:

- Connect for control plane
- WebSocket for stream
- SSE for freshness only
- no terminal byte stream in proto

Acceptance:

- proto surface matches the terminal plan
- route namespace is explicit:
  - `POST /rpc/hopter.v1.TerminalService/*`
  - `GET /terminals/:terminalId/stream`

## Milestone T1 — Backend Core

### T101 Add terminal domain model

Files:

- `internal/terminal/model.go`

Add:

- `TerminalID`
- `TerminalStatus`
- `TerminalSessionRuntime`
- `ForegroundCommandState`
- `DetachState`

Required fields:

- terminal id
- project id
- session id
- browser instance id
- tab id
- cwd
- shell
- attach status
- created at
- last activity at
- last output at
- exit code
- terminated flag
- recent output ring buffer
- last foreground command summary
- last foreground command exited boolean

Acceptance:

- model expresses the full runtime semantics without leaking transport concerns

### T102 Add in-memory terminal store

Files:

- `internal/terminal/store.go`

Behavior:

- index by terminal id
- secondary lookup by `browser_instance_id + tab_id + session_id`
- no persistence across restart

Acceptance:

- same-tab reconnect lookup works
- restart loses terminal state honestly

### T103 Add PTY runtime

Files:

- `internal/terminal/pty_runtime.go`

Dependencies:

- `github.com/creack/pty`

Behavior:

- spawn login + interactive shell
- cwd = session project root
- inherit user shell environment
- support write, resize, kill
- stream output lines/bytes back to manager

Acceptance:

- shell starts successfully on macOS
- resize mutates real PTY size
- terminate kills the PTY immediately

### T104 Add terminal manager

Files:

- `internal/terminal/manager.go`

Responsibilities:

- create or reuse terminal for same `browser_instance_id + tab_id + session_id`
- attach / detach
- start cleanup timers
- cancel cleanup timers on reattach
- preserve live terminal while foreground command is still running
- close detached terminal 5 minutes after prompt returns
- kill all tab terminals on logout/auth expiry
- mark restart recovery as degraded

Acceptance:

- same-tab refresh reuses terminal
- different tab does not
- detached prompt state cleans up after 5 minutes
- detached foreground task is preserved indefinitely

### T105 Add output replay buffer

Files:

- `internal/terminal/manager.go`
- `internal/terminal/model.go`

Behavior:

- keep last 128 KB of output in memory
- replay buffer on same-tab reattach
- drop buffer on exit, terminate, or runtime cleanup

Acceptance:

- refresh reconnect shows recent output
- exited terminal does not pretend to have durable history

## Milestone T2 — Transport

### T201 Add Connect terminal service

Files:

- `internal/rpc/terminal_service.go`
- generated proto outputs

Methods:

- `CreateTerminalSession`
- `GetTerminalSession`
- `TerminateTerminalSession`

Acceptance:

- Create returns existing live terminal for same browser/tab/session tuple
- Get returns accurate live, exited, terminated, degraded states
- Terminate enforces confirmation on client side only, not server side

### T202 Add terminal WebSocket stream

Files:

- `internal/http/terminal_ws.go`
- `internal/terminal/stream_hub.go`

Browser -> server messages:

- `input`
- `resize`
- `ping`

Server -> browser messages:

- `ready`
- `output`
- `exit`
- `terminated`
- `error`
- `pong`

Acceptance:

- stream attaches only for matching browser/tab/session terminal
- copied tab or different device cannot reuse old terminal
- reconnect works for same tab

### T203 Add SSE terminal freshness events

Files:

- `internal/events/*`
- `idl/hopter/v1/events.proto` if needed

Event classes:

- terminal created
- terminal attached
- terminal detached
- terminal exited
- terminal terminated
- terminal degraded

Acceptance:

- browser can refresh session-local terminal metadata without polling everything

## Milestone T3 — Frontend Shell Integration

### T301 Add terminal control hooks

Files:

- `ui/src/features/terminal/use-terminal-session.ts`
- `ui/src/features/terminal/use-terminal-stream.ts`

Responsibilities:

- create terminal through Connect
- fetch terminal metadata
- terminate terminal
- attach WebSocket stream
- reconnect same-tab terminal
- surface startup and reconnect errors

Acceptance:

- hook API is transport-thin and session-centric

### T302 Add tab/browser identity helpers

Files:

- `ui/src/features/terminal/browser-identity.ts`

Behavior:

- stable `browser_instance_id` in `localStorage`
- stable `tab_id` in `sessionStorage`
- copied/new tab gets its own `tab_id`

Acceptance:

- refresh preserves `tab_id`
- browser restart loses `tab_id`
- copied tab does not reuse live terminal

### T303 Add session-local UI state

Files:

- `ui/src/features/terminal/use-terminal-ui-state.ts`

State:

- per-session drawer open/closed
- per-session drawer height
- per-session header cache
- no restore of open state after refresh

Acceptance:

- Session A and Session B keep separate drawer state within the tab
- refresh always starts closed

### T304 Add terminal drawer and header

Files:

- `ui/src/features/terminal/terminal-drawer.tsx`
- `ui/src/features/terminal/terminal-header.tsx`

Header must show:

- shell name
- short cwd
- natural-language status
- truncated foreground command summary when relevant

Header must not show:

- session title
- idle label
- extra badges

Acceptance:

- header is fixed
- drawer has minimum height floor
- hidden drawer does not kill terminal

### T305 Integrate `wterm`

Files:

- `ui/src/features/terminal/terminal-surface.tsx`

Dependencies:

- `@wterm/react`
- `@wterm/dom`

Responsibilities:

- mount terminal renderer
- forward resize
- focus terminal on open
- do not steal focus on reconnect

Acceptance:

- native selection works
- direct input works on open
- resize works with drawer drag and viewport changes

### T306 Add topbar integration

Files:

- `ui/src/components/app/workspace-topbar.tsx`
- `ui/src/components/app/session-detail-pane.tsx`

Behavior:

- topbar button opens drawer immediately into `Starting terminal...`
- if startup continues in background and user hides drawer, opening later reuses the same startup/live terminal
- light active state when live terminal exists but drawer is hidden
- if exited terminal drawer was hidden, next open creates a fresh terminal

Acceptance:

- topbar behavior matches the fixed product semantics

### T307 Hide terminal on phone viewport

Files:

- terminal entrypoint integration
- posture/device helpers

Acceptance:

- phone viewport has no terminal button
- desktop and large touch screens keep terminal access

## Milestone T4 — Lifecycle and Error Paths

### T401 Startup, reconnect, exit, terminate states

Implement explicit UI states:

- `Starting terminal...`
- `Live`
- `Reconnecting...`
- `Exited`
- `Terminated`
- startup failed
- reconnect failed
- degraded after restart

Acceptance:

- each state has specific drawer UX
- errors stay in drawer with `Retry`

### T402 Terminate flow

Behavior:

- `Terminate terminal` lives in drawer header overflow
- if foreground command still running, ask for confirmation
- otherwise terminate immediately
- termination is hard kill
- final content remains visible until drawer is hidden

Acceptance:

- terminated terminal shows final state
- hiding terminated drawer clears that terminal view

### T403 Logout and auth expiry cleanup

Behavior:

- logout closes all live terminals for the current tab immediately
- expired auth cannot leave live PTYs orphaned

Acceptance:

- security boundary is enforced even when terminal is detached

## Milestone T5 — Validation

### T501 Backend validation

Add:

- unit tests for terminal store
- unit tests for cleanup rule
- integration tests for PTY create / attach / input / resize / terminate

Required scenarios:

- same browser + same tab + same session returns existing live terminal
- copied tab gets a new terminal
- different browser instance gets a new terminal
- detached live command is preserved
- detached prompt state closes after 5 minutes
- logout kills all tab terminals

### T502 Frontend validation

Add:

- browser automation for session-detail terminal UX

Required scenarios:

- open session page and create terminal from topbar
- drawer opens immediately into startup state
- terminal gains focus on open
- refresh keeps terminal available but does not auto-open drawer
- reconnect succeeds automatically on same tab
- reconnect failure shows retry state in drawer
- exited state shows `Reopen terminal`
- hidden exited drawer reopens as a fresh terminal
- phone viewport hides terminal entrypoint

### T503 Renderer spike evidence

Before blessing `wterm` as final:

- validate resize
- validate reconnect
- validate `vim`
- validate `less`
- validate long-output scrolling

Evidence:

- screenshots
- browser logs
- pass/fail note in evidence bundle

## Evidence paths

Add a dedicated validation lane:

```text
scripts/validate-go-terminal.ts
storage/artifacts/validation/terminal_<timestamp>/
storage/artifacts/validation/latest-go-terminal.txt
```

Minimum evidence bundle contents:

- metadata summary
- backend test output
- browser automation output
- screenshots for desktop and large touch layout
- renderer spike verdict

## Suggested execution order

1. T001 contract lock
2. T101-T105 backend core
3. T201-T203 transport
4. T301-T307 frontend shell integration
5. T401-T403 lifecycle and error paths
6. T501-T503 validation and evidence

## Exit criteria

This task list is done when a reviewer can verify all of the following with evidence:

- same-tab refresh reattaches
- different tab does not reuse terminal
- different device does not reuse terminal
- detached prompt state closes after 5 minutes
- detached foreground command survives
- logout kills live terminal
- phone viewport hides terminal
- topbar launch and hidden active-state behavior work
- `wterm` is proven acceptable for this repo's terminal UX and lifecycle contract
