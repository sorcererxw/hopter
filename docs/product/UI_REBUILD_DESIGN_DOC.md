# UI Rebuild Design Doc

## Purpose

Define the rebuilt browser UI for the Go + Connect + SSE architecture.

This document replaces the earlier dashboard/project/session split emphasis with a workspace-first design centered on session re-entry and session control.

## Design summary

The rebuilt UI is not a classic admin console and not a content-heavy dashboard.

It is a **workspace shell** with:

- a persistent session rail on the left
- a persistent work pane on the right
- session as the primary object
- project as supporting metadata, not the dominant navigation model

## Primary interaction model

### Core job

The user should be able to:

1. open the app
2. immediately see recent sessions
3. switch into a session with one tap/click
4. continue or steer work from the same shell

The product should feel like re-entering a live workspace, not navigating through an admin hierarchy.

## Route model

- `/` — workspace shell with no selected session
- `/sessions/:sessionId` — same shell with one selected session
- `/projects/new` — add/create project flow
- `/settings` — low-frequency system controls
- `/login` — only if/when a login surface exists for non-dev modes

## Shell layout

```text
+--------------------------------------------------------------+
| Header / host status / utility actions                       |
+---------------------------+----------------------------------+
| Left rail                 | Right workspace pane             |
|                           |                                  |
| Session list              | Empty state OR selected session  |
|                           |                                  |
|                           | - title / status                 |
|                           | - summary / attention            |
|                           | - input/composer                 |
|                           | - artifacts / timeline metadata  |
+---------------------------+----------------------------------+
```

## Information hierarchy

### Highest priority

1. current session state
2. what needs user input or attention
3. session continuity and re-entry
4. ability to submit the next instruction quickly

### Lower priority

- project metadata
- host diagnostics
- settings
- system controls not needed for immediate work

## Left rail design

### Purpose

Make session switching effortless.

### Contents

Each item should show at least:

- session title or primary label
- project name
- concise status indicator
- concise freshness cue (active/recent)

### Rules

- keep the list flat at first
- do not introduce grouped sections unless usage proves the flat list is insufficient
- support narrow/mobile collapse later, but keep the desktop rail persistent by default

## Right pane states

### State A: no selected session

Use the right pane for:

- a new-session composer
- a short explanation of what the workspace does
- optional quick actions like add project

This state should feel purposeful, not empty.

### State B: selected session

The right pane becomes the active control surface.

The vertical order should be:

1. session header/status
2. summary / latest meaningful state
3. explicit attention block if action is required
4. input/composer for steering or follow-up
5. artifacts metadata / recent outputs
6. timeline or event history

This preserves the principle that the user should understand the session before digging into detail.

## Session header

Must answer quickly:

- what session is this?
- what project is it attached to?
- is it healthy, waiting, running, completed, or degraded?

It should stay visually compact.

## Summary block

The summary block is the user's fastest comprehension tool.

It should prefer:

- latest meaningful summary
- most recent completion/status explanation
- explicit degradation explanation when needed

Avoid forcing the user to read a long timeline just to understand the current state.

## Attention block

Show only when needed.

Examples:

- requires input
- waiting on approval
- degraded state
- session failed or became stale

This block should be visually stronger than surrounding content.

## Composer / input surface

The main input affordance should stay highly visible.

Requirements:

- visible in both empty and selected-session states
- consistent placement
- supports short steering messages without extra ceremony
- does not require navigating to a separate compose page

The composer is part of the core loop and must not be buried.

## Artifact and timeline surface

For the current phase, artifacts should be presented as metadata-first surfaces.

Examples:

- latest summary artifact
- changed files summary
- test result metadata
- screenshot metadata if available

Timeline should be a supporting surface, not the dominant first-read surface.

## Project handling

Projects still matter, but they are not the dominant home screen abstraction.

Project information should appear as:

- supporting metadata in session items
- context in selected session header
- separate creation flow at `/projects/new`

There is no requirement for a dedicated project detail page in the rebuilt UI.

## Host and settings surfaces

Keep them out of the main work loop.

### Header-level host signals

Allow small indicators for:

- host health
- backend availability
- connection state

### Settings page

Use for:

- environment info
- version/build info
- future auth or relay settings
- project management controls that are not part of the main session loop

## Mobile and narrow-screen posture

The UI remains browser-first and mobile-aware, but the desktop workspace model is still primary.

Guidelines:

- preserve the same shell semantics
- collapse the left rail when needed
- never turn the product into a terminal-style mobile app
- keep input and attention blocks easy to reach

## Visual system direction

### Tone

- calm
- low-chrome
- operational
- trustworthy
- not playful, not enterprise-heavy

### Styling rules

- Tailwind utility styling remains allowed and expected
- HeroUI v3 should back interactive primitives
- app-layer code should use HeroUI directly or the temporary `heroui-adapter.tsx` compatibility layer
- compatibility wrappers should be simplified toward HeroUI compound APIs over time
- avoid introducing a parallel custom primitive layer

## Interaction rules

### Navigation

- session switching should feel instantaneous
- route changes should preserve shell continuity
- direct navigation to `/sessions/:sessionId` should render the same shell with a selected item

### Loading

- prefer shell-first rendering with local skeleton states
- keep the shell stable while data loads

### Realtime

- SSE should update freshness and state without overwhelming the UI
- event bursts should not visually spam the user
- the UI should translate backend change into clear state, not raw event noise

## Success criteria

The rebuilt UI succeeds when a user can:

1. open the product and immediately understand where to continue
2. switch sessions with minimal friction
3. understand the current session state without digging through a long timeline
4. send the next instruction from the same screen
5. feel that the workspace is light, calm, and responsive

## Anti-goals

Do not build:

- a dashboard overloaded with cards and metrics
- a project-centric admin IA
- a timeline-first reading experience
- a separate page for every small object
- a design system that drifts away from Tailwind + HeroUI-backed primitive discipline
