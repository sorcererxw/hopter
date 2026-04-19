# Settings Surface Plan

## Status

- status: approved for implementation
- scope: `/settings` information architecture, content scope, and first-pass data requirements
- source: user-directed scope decisions captured in live product discussion

## Why this plan exists

The current settings route mixes real controls with placeholder desktop-app preferences.

That is the wrong shape for `hopter`.

The product docs already define settings as a low-frequency system control surface, not a giant preferences center. This plan locks the settings scope to that reality so implementation does not drift back into fake toggles and empty categories.

## Product decision

`/settings` is a real system surface.

It is not:

- a desktop-client preferences page
- a catch-all dumping ground
- a fake control panel full of inert toggles

It should only contain:

- real controls
- real system status
- real globally discoverable capability inventory

## Route model

Settings becomes a small routed section, not one stateful page with fake tabs.

### Routes

- `/settings`
- `/settings/appearance`
- `/settings/plugins`
- `/settings/agents`

### Default behavior

- `/settings` resolves to the `General` view
- all settings sections must be directly openable and refresh-safe
- homepage skill/plugin entry points should deep-link into `/settings/plugins`

## Left navigation

Keep a persistent left navigation inside settings.

### Order

1. `General`
2. `Appearance`
3. `Plugins`
4. `Agents`

### Naming

- `General` replaces `System`
- `General` is the top-level miscellaneous systems page
- do not reintroduce extra placeholder items such as `Git`, `Environment`, `Worktree`, or `Archived Threads`

## Section definitions

## 1. General

Purpose: lightweight miscellaneous systems page.

### First-pass contents

- a small list surface
- exactly one real item to start: `Host status`

### Host status rules

- render as part of a list, not as a lone hero card
- show result-only status
- do not expose verbose debug details in the first pass

### Explicitly out of scope for General v1

- logout
- auth/access mode
- version/build info
- Codex explainer copy
- project/session count stats
- about/help copy

## 2. Appearance

Purpose: hold real visual preferences only.

### First-pass contents

- `Theme`
  - `System`
  - `Dark`
  - `Light`

### Rules

- this page contains exactly one real setting in v1
- do not include font pickers, density, animation, language, or other speculative preferences

## 3. Plugins

Purpose: global capability inventory, not a management console.

### First-pass contents

- overview counts at the top
- one unified search field
- `Skills` section
- `MCP` section

### Skills rules

- show global skills only
- do not mix in project-local skills
- each item shows:
  - name
  - description

### MCP rules

- this must be a real MCP server list, not a relabeled backend list
- each item shows:
  - name
  - configuration status
- first-pass status semantics are configuration-oriented, not runtime-health-oriented
- do not add management actions in v1

### Search rules

- one search box filters both `Skills` and `MCP`
- empty search results must show an explicit empty state

### Navigation rules

- homepage plugin entry points deep-link to the relevant section
- homepage skill entry points deep-link to the relevant section

## 4. Agents

Purpose: backend inventory page.

The user clarified that this page is about supported backends, not agent explainer copy.

### First-pass contents

- one vertical list of supported backends

### Item rules

Each backend row shows:

- backend name
- backend status

### Explicitly out of scope for Agents v1

- switching default backend
- editing backend config
- per-backend explanation copy
- management actions

## What must be removed from the current settings page

These items are explicitly rejected and should not survive the rebuild:

- `Default open target`
- `Language`
- `Thread verbosity`
- `Show in menu bar`
- `Keep system awake while running`
- `Speed`
- `Interface font`
- `Code font`
- placeholder sections for `Config`, `MCP Servers`, `Git`, `Environment`, `Worktree`, `Archived Threads`
- generic placeholder copy that admits the page is not real yet

## Data contract requirements

## Already available

These can already back the new settings surface:

- theme state in the frontend
- host status
- backend list/status
- global skill discovery

## New data work required

`/settings/plugins` needs a real global MCP server inventory.

That requires a dedicated backend surface instead of pretending backends are MCP servers.

### Minimum MCP inventory output

Each MCP item must provide:

- stable display name
- configuration status

Optional later fields:

- source
- path
- enablement controls
- transport details

## Information architecture guardrails

Do not turn settings into:

- a dashboard
- a desktop-electron preferences clone
- an operational debugging dump
- a management console full of disabled controls

Do keep it:

- low-frequency
- truthful
- easy to scan
- backed by real data

## Implementation slices

### Slice 1: route split

- convert settings sections into real subroutes
- make `/settings` resolve to `General`

### Slice 2: content pruning

- remove placeholder sections and inert controls from the current route

### Slice 3: General + Appearance

- build `General` with host status list item
- build `Appearance` with theme only

### Slice 4: Agents

- add `/settings/agents`
- render supported backend list with name + status

### Slice 5: Plugins

- add `/settings/plugins`
- render overview counts
- add unified search
- render global `Skills`
- render real global `MCP`

### Slice 6: deep links

- update homepage skill/plugin entry points to jump into the matching section inside `/settings/plugins`

## Validation requirements

Implementation is not complete until these are proven with evidence:

1. `/settings` opens `General` by default
2. `/settings/appearance` persists and applies theme changes
3. `/settings/plugins` renders overview counts, search, `Skills`, and real `MCP`
4. `/settings/plugins` empty search state is explicit
5. `/settings/agents` renders all supported backends with name + status
6. homepage skill/plugin entry points deep-link into the correct `/settings/plugins` section

Evidence should include:

- route screenshots
- at least one interaction proof for deep-linking
- one search-empty screenshot
- one screenshot each for `General`, `Appearance`, `Plugins`, and `Agents`

## Final summary

This plan makes settings smaller and more real.

`General` holds the miscellaneous systems stub, but only with real content.
`Appearance` becomes theme-only.
`Plugins` becomes the global capability directory.
`Agents` becomes the supported backend inventory.

That is enough structure to feel intentional without pretending we already built a full management console.
