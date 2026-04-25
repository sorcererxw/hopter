# Frontend Execution Plan

## Goal

Rebuild the browser UI as a lightweight React + Vite control plane that:

- is always accessed through the Go server origin
- keeps a workspace-first shell
- treats session as the primary object
- uses TanStack Query for server state
- uses SSE for notification-driven refresh
- ships as a minimal static artifact under `ui/dist`

## Scope

Included:

- Vite app scaffold under `/ui`
- React Router shell
- workspace layout with left session rail and right content pane
- project creation surface
- selected session route
- TanStack Query integration
- Connect-Web client integration
- SSE integration
- Tailwind + HeroUI-backed primitive setup

Excluded:

- terminal UI
- relay settings UI
- full auth UX beyond a dev-localhost assumption

## Repository targets

```text
/ui
  /src
    /routes
    /components
      /ui
      /hopter
    /features
      /projects
      /sessions
      /workspace
      /settings
    /lib
      /connect
      /query
      /sse
      /utils
```

## Route model

The active route set is intentionally small.

- `/`
- `/sessions/:sessionId`
- `/projects/new`
- `/login`
- `/settings`

Interpretation:

- `/` renders the workspace shell with no selected session
- `/sessions/:sessionId` renders the same shell with the right pane focused on one session
- `/projects/new` can be a route-backed creation flow even if the final UX uses a modal or panel launch

## Layout model

### Workspace shell

Persistent structure:

- left rail: session list
- right pane: current workspace content

The shell should not disappear during normal intra-app navigation.

### Left rail responsibilities

- list recent and active sessions in one simple list
- show enough metadata to re-enter confidently
- allow quick switching without leaving the shell

### Right pane responsibilities

- empty state when no session is selected
- session composer/new session flow when appropriate
- selected session summary + action/input surface when a session is selected

## Data model in the browser

### Server state

Use TanStack Query for:

- host status
- project list
- session list
- selected session detail
- summary/artifact metadata

### UI state

Use React local state/context/reducer for:

- shell open/close or responsive toggles
- current input draft
- local filters/search text if needed
- dialog or panel state

### Rule

Do not introduce Zustand/Redux by default.

## Connect-Web integration

Create a thin client layer under `ui/src/lib/connect`.

Requirements:

- generated client/types come from Buf-managed IDL output
- all query functions consume the generated clients
- frontend code should not handcraft ad hoc transport contracts once IDL exists

## SSE integration

Use one `EventSource` connection to `/events`.

First-pass frontend behavior:

- connect once near app shell bootstrap
- on relevant event types, invalidate or patch TanStack Query caches
- keep event handling conservative and understandable

Do not build a second browser-side event architecture.

## UI system rules

### Tailwind and HeroUI

- Tailwind remains the styling baseline
- HeroUI v3 is the primitive implementation baseline
- `ui/src/components/app/shared/heroui-adapter.tsx` is a temporary compatibility layer for callsites that still use older prop names
- new app-layer work should prefer direct HeroUI compound APIs when practical

### Design intent

- minimal chrome
- mobile-aware, but desktop workspace remains first-class
- no overloaded dashboard homepage
- keep the shell focused on immediate re-entry and action

## Execution slices

### Slice 1: frontend toolchain reset

Deliverables:

- `/ui/package.json`
- `/ui/vite.config.*`
- `/ui/src/main.tsx`
- Tailwind + HeroUI-backed primitive baseline

Acceptance criteria:

- `pnpm dev` runs Vite
- Go can reverse-proxy the UI
- `pnpm build` outputs `ui/dist`

### Slice 2: app shell and routing

Deliverables:

- React Router shell
- workspace layout
- route placeholders for `/`, `/sessions/:sessionId`, `/projects/new`, `/settings`

Acceptance criteria:

- browser can navigate between shell states without full-page reload
- shell chrome remains stable across route changes

### Slice 3: server-state integration

Deliverables:

- TanStack Query provider
- first query keys and cache helpers
- Connect client hooks/utilities

Acceptance criteria:

- host, project, and session data flow through query-backed hooks
- no duplicated fetch state machinery appears per feature

### Slice 4: SSE + cache update path

Deliverables:

- app-level SSE bootstrap
- event handlers that trigger query invalidation or safe patching

Acceptance criteria:

- a backend event updates visible UI state without a manual refresh

### Slice 5: project/session workflows

Deliverables:

- project creation flow
- session selection flow
- session input/submit flow
- summary and artifact metadata surface

Acceptance criteria:

- core workspace loop is usable without legacy Bun UI code

## Risks and mitigations

### Risk: homepage grows into a second dashboard

Mitigation:

- treat `/` as the empty/default shell state, not a kitchen-sink overview page

### Risk: query + SSE logic becomes hard to follow

Mitigation:

- keep SSE handling as cache refresh signals first
- only add fine-grained client patching when clearly valuable

### Risk: UI primitives diverge into parallel systems

Mitigation:

- keep compatibility imports pointed at `heroui-adapter.tsx` until callsites are simplified
- prefer direct HeroUI compound APIs for new or touched UI surfaces
- put hopter-specific semantics above, not inside, primitive wrappers

## Verification

- route navigation through the Go origin in dev
- session selection reflected by `/sessions/:sessionId`
- query-backed data rendering
- SSE-triggered refresh behavior
- production build loaded from embedded `ui/dist`
