# Product Memo

## One-line Definition

`hopter` is a self-hosted browser control plane for local coding agents. It runs
on the user's own machine and lets them continue the same local Codex workflow
from a phone, laptop, tablet, or another browser.

## Product Boundary

`hopter` is not a new coding agent, a planner that replaces backend reasoning, a
browser IDE, a terminal-first shell, or a generic AI chat wrapper.

Codex remains the source of truth for:

- session content
- session history
- approval semantics
- artifact semantics

`hopter` owns only the thin control-plane layer around that truth:

- projects
- lightweight session references
- auth state
- validation evidence
- UI-facing status and attention state

## Core Wedge

The product exists for one job:

> Keep work moving on the user's real local development machine, even when the
> user is away from that machine.

The value is continuity:

- same machine
- same repo/project context
- same agent context
- same workflow
- continuous iteration across devices

## Active V1 Shape

- Backend runtime: Go
- Primary backend: Codex
- Browser API: Connect
- Browser notifications: SSE
- Codex integration target: `codex app-server` over stdio
- Frontend: React + Vite
- Distribution target: one Go binary serving embedded `ui/dist`
- Primary host: macOS
- Linux: best-effort compatible
- Windows: out of scope for v1

## Product Objects

### Project

A project is the local repo/workspace context that the user chooses on the host
machine. The browser does not enumerate the client device's filesystem; project
truth comes from the Go server running on the user's machine.

### Session

A session is the main operational object in the UI. It represents a Codex-backed
work loop inside a project.

The workspace should optimize for session re-entry, attention, approval, and
follow-up input. It should not make repo administration or terminal output the
default center of gravity.

### Thread

Thread is the Codex app-server protocol object behind a Hopter session. Hopter
may store a backend thread id and call raw `thread/*` methods, but users should
not have to understand or choose threads in the product UI.

### Chat

Chat is only the message-style interaction pattern inside a session. It is not a
separate product object, route, storage model, or navigation label.

## Product Language

Use **session** for user-facing product copy and Hopter-owned API concepts.
Use **thread** only at the Codex protocol boundary and in adapter internals that
directly mirror Codex app-server shapes. Use **chat** only as descriptive
language for the composer/transcript interaction style, not as an entity name.

## Workspace UI

The main UI is a workspace shell:

- left session rail
- right workspace pane
- routes:
  - `/`
  - `/sessions/:sessionId`
  - `/projects/new`
  - `/settings`

Priority order inside the selected session pane:

1. status
2. summary
3. attention
4. input/composer
5. artifacts
6. timeline/history

Timeline is useful context, but it is not the default focus.

## In Scope For V1

- local Go control-plane server
- React/Vite browser workspace
- localhost-only dev auth
- project creation and selection
- Codex-backed session creation/resume
- follow-up input through Connect
- status updates through SSE
- embedded production UI served by the Go binary
- evidence-backed validation for the end-to-end session loop

## Deferred

- relay/tunnel delivery
- production-grade auth
- terminal streaming
- multi-user collaboration
- native mobile app
- generic multi-agent orchestration
- browser IDE/file editing

Deferred work may have planning notes, but those notes do not override the
Go-first, Codex-first v1 architecture.

## Success Criterion

The active rebuild is successful when a user can start `hopter`, open the
workspace through the Go server, create/select a project, create/resume a
Codex-backed session, send follow-up input, receive status updates, and validate
the loop with recorded evidence.
