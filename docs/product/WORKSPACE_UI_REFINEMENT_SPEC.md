# Workspace UI Refinement Spec

## Status

- status: approved for implementation
- scope: workspace shell, touch behavior, composer, topbar, rail, typography, reading surfaces
- based on: live review of `localhost:8787` plus product discussion

## Purpose

This document turns the current UI review into implementation-ready rules.

[`UI_REBUILD_DESIGN_DOC.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/hopter/docs/product/UI_REBUILD_DESIGN_DOC.md) still defines the product shape.
This document defines the next-pass refinement rules that should guide the actual UI implementation.

The goal is not "make it prettier."

The goal is:

- make the workspace feel more intentional
- make touch interaction actually usable
- remove generic SaaS/card-shell patterns
- strengthen typography so the product stops feeling light, blurry, and noncommittal

## Non-goals

This spec does not do the following:

- replace shadcn primitives
- introduce a second component library
- redesign the route model from scratch
- add a real terminal implementation
- turn the product into a mobile IDE

## Hard constraints

1. Do not modify `ui/src/components/ui/*` primitives unless there is a true primitive bug.
2. Apply the refinement pass in `ui/src/components/app/*` and `ui/src/index.css`.
3. Keep the product as a workspace shell, not a dashboard and not a marketing page.
4. Keep `Geist Variable + JetBrains Mono`.
5. Use Tailwind tokens and semantic classes, not ad hoc pixel-level tuning as the primary system.

## Design intent

The product should feel like a calm, durable control surface for ongoing work.

It should not feel like:

- a generic AI chat shell
- a card-heavy SaaS admin
- a terminal cosplay UI
- a pile of default dark theme components

The visual posture is:

- low chrome
- strong hierarchy
- dense where useful
- quiet where not useful
- operational
- deliberate

## Primary product decisions

### What stays

- The initial shell can still be a blank chat-oriented entry state.
- The workspace remains session-first.
- Desktop and large screens keep a left rail plus right workspace.
- The composer remains the main action surface.

### What changes

- Remove template-like starter prompt cards from the empty state.
- Reduce the amount of always-visible metadata in the rail.
- Rework topbar behavior by device class.
- Make the composer a true foreground control layer.
- Strengthen the reading system across the product.

## Device model

All interaction rules should be designed against three device classes.

### 1. Phone portrait

Characteristics:

- thread list and thread view are separate pages
- topbar is restructured for one-handed use
- all secondary actions collapse aggressively
- selector interactions should prefer bottom sheets

### 2. Large touch screens

Examples:

- iPad landscape
- touch laptops in touch-first posture

Characteristics:

- information architecture follows desktop
- touch sizing and spacing follow touch rules
- side rail remains persistent
- menus can still exist, but menu rows must feel touch-friendly

### 3. Desktop pointer

Characteristics:

- highest information density
- dropdown/pop menus are acceptable
- hover is available
- side rail remains persistent

## Layout rules

## Global shell rules

1. On large screens, the left rail is persistent.
2. On phones, the thread list is the entry page and a thread becomes an independent page.
3. The composer is fixed to the bottom on all device classes.
4. Main content scrolls behind the composer.
5. The composer must read as a clear foreground layer, never as a broken overlap.

## Content layering

The main content and the composer do not occupy equal visual depth.

- content is the flowing workspace surface
- composer is the stable foreground control surface

The user should immediately understand:

- messages and artifacts move
- the input surface stays

## Topbar spec

## Large screens

Topbar uses a left-right split.

### Left side

- thread title
- project name
- overflow menu trigger (`...`) for context actions

Layout rule:

- thread title and project name are inline on large screens
- if space becomes tight, title truncates before primary actions are removed

### Right side

Keep only:

- `Commit` button
- terminal launch icon button
- right-side panel toggle icon button

#### Commit button behavior

The `Commit` button is a regular button, not an icon.

It opens a popup menu with exactly:

- `Commit`
- `Review`
- `Commit & Review`

#### Terminal button behavior

This is a placeholder entry only.

The UI exists now.
The real terminal function can land later.

#### Theme / settings behavior

Theme should not live as a persistent topbar button.

Settings behavior:

- desktop: open a popup menu
- large touch screens: still open a popup menu, but with touch-friendly rows

The popup menu must contain:

- a quick dark mode toggle
- an item that navigates to `/settings`

## Phone topbar

Phone topbar is not a compressed desktop topbar.
It is a different layout.

### Left side

- back button to thread list
- two-line title stack
  - primary line: thread title
  - secondary line: project name

### Right side

- a single `...` menu button

All other actions are removed from the visible phone topbar.

### Phone `...` menu

The phone overflow menu is a flat action list.

Current phase:

- it only contains `Copy session ID`

No other item is required in this menu for now.

## Rail spec

The rail should return to being navigation, not a metadata panel.

### Rail item content

Each thread row should show only:

- status icon
- title
- relative last-active time

### Rail item content that should be removed

- project name in the row body
- backend tag
- full path
- expandable metadata

### Status display

- use the leading status icon as the default signal
- show stronger treatment only for special states
- do not make every thread row shout

## Composer spec

The composer is the most important interactive surface in the product.

## Core behavior

1. Fixed to the bottom on every screen class.
2. Content scrolls underneath it.
3. Visually foregrounded.
4. Send is the primary action.
5. Other controls are secondary.

## Control hierarchy

### Primary action

- send button

The send button must be visibly stronger than every other composer control on small screens.

### Secondary persistent actions

- `+`
- model selector
- reasoning selector
- voice

### Control-specific rules

#### `+`

- stays visible
- remains secondary
- never competes visually with send

#### Model selector and reasoning selector

- remain in the composer
- use ghost-button styling
- must feel lighter than the send button

Interaction mode:

- desktop: dropdown/pop menu
- small screens: bottom sheet

### Lower metadata row

The composer keeps a two-row structure.

However:

- the upper action row carries the interaction weight
- the lower metadata row is subordinate

Do not let the lower row read like a row of equal-priority controls.

## Touch behavior rules

Touch behavior is not solved by a global density toggle.

Do not treat this as "scale everything up."

The order of operations is:

1. grouping
2. spacing
3. layout
4. size refinement

This means:

- first decide which controls should coexist
- then decide which controls should be visually near or far
- then restructure the layout
- only then raise touch target size where needed

## Typography system

The current problem is not font family selection.
The problem is weak hierarchy.

The product feels visually light because too much content lives in the same small, low-contrast, semi-muted typographic voice.

## Font family

Keep:

- primary UI and reading font: `Geist Variable`
- code and technical surfaces: `JetBrains Mono`

Do not replace them in this pass.

## Base text rules

### Global body baseline

The default body baseline should move up to `text-base`.

This applies especially to:

- readable content
- summaries
- assistant messages
- explanatory text

### Reading weight

Primary reading surfaces should default to at least `font-medium`.

The goal is to stop the UI from feeling:

- blurry
- weak
- low-commitment

### Muted text usage

Reduce `text-muted-foreground` usage sharply.

Use muted text only for:

- timestamps
- weak hints
- secondary tails
- nonessential metadata

Do not use muted text as the default voice for:

- summaries
- assistant prose
- explanation paragraphs
- status explanations the user actually needs to read

## Rich text / reading surface rules

`SessionRichText` should become a reading-first renderer, not a minimal markdown wrapper.

## Required changes in reading behavior

1. Do not rely only on markdown `**strong**` to create hierarchy.
2. Recognize common conversation structures and separate them visually.
3. Give long-form assistant output a stronger reading rhythm.
4. Allow variable weight to do real work.

## Structures the renderer should recognize

At minimum, support better visual treatment for:

- conclusion lines
- lead-in labels such as `Status:` or `Next:`
- list headers versus list body
- inline technical values
- short paragraphs versus long reading blocks

## Message density by content type

Small screens should not use one spacing rule for every message.

### Normal chat messages

- more compact
- faster scan rhythm

### Long text, summaries, explanations

- looser paragraph rhythm
- stronger reading hierarchy
- more confident weight

### Status / artifact / system surfaces

- separate density rules
- not identical to prose

## No-card rule for reading blocks

Do not solve long-text readability by wrapping everything in cards.

Long-form reading blocks should be distinguished by:

- typography
- spacing
- rhythm
- light separators

Not by:

- heavy borders
- repeated rounded containers
- card-inside-card structure

## Surface language

The current surface language is too soft.

The interface should move away from broad use of:

- `rounded-2xl`
- repeated framed containers
- card-within-card patterns

Preferred direction:

- more `rounded-lg` and `rounded-md`
- fewer decorative containers
- stronger hierarchy through structure, not wrappers

## Tailwind implementation guidance

This refinement pass should be expressed in Tailwind terms.

Examples of the intended direction:

- readable body content moves toward `text-base`
- primary reading surfaces use `font-medium`
- helper/meta text remains `text-sm` or `text-xs`
- mobile touch controls move toward stronger `min-h-*` / `size-*` classes where needed
- selectors become ghost buttons instead of bordered chips with too much visual weight
- large soft corners move toward `rounded-lg` / `rounded-md`

This pass should avoid a fake "global DPI switch."

## Implementation map

The following files are the expected touch points for implementation.

### Core

- [`ui/src/index.css`](/Users/sorcererxw/repo/sorcererxw/codeshell/hopter/ui/src/index.css)
- [`ui/src/components/app/workspace-topbar.tsx`](/Users/sorcererxw/repo/sorcererxw/codeshell/hopter/ui/src/components/app/workspace-topbar.tsx)
- [`ui/src/components/app/session-composer.tsx`](/Users/sorcererxw/repo/sorcererxw/codeshell/hopter/ui/src/components/app/session-composer.tsx)
- [`ui/src/components/app/session-rail.tsx`](/Users/sorcererxw/repo/sorcererxw/codeshell/hopter/ui/src/components/app/session-rail.tsx)
- [`ui/src/components/app/session-detail-pane.tsx`](/Users/sorcererxw/repo/sorcererxw/codeshell/hopter/ui/src/components/app/session-detail-pane.tsx)
- [`ui/src/components/app/session-rich-text.tsx`](/Users/sorcererxw/repo/sorcererxw/codeshell/hopter/ui/src/components/app/session-rich-text.tsx)

### Principles for implementation

1. Prefer app-layer composition changes over primitive edits.
2. Remove visual noise before adding new visual treatment.
3. Preserve product hierarchy:
   - status/header
   - summary
   - attention
   - composer
   - artifacts
   - timeline
4. Make mobile behavior intentionally different where required.

## Acceptance criteria

The refinement pass should be considered complete only when all of the following are true.

1. The empty state no longer relies on starter prompt cards.
2. The rail shows only status, title, and relative time.
3. The topbar behavior diverges correctly between phone and large screens.
4. The composer is fixed-bottom on all screens and clearly foregrounded.
5. Send is the dominant composer action.
6. Model and reasoning selectors use ghost treatment and device-specific reveal behavior.
7. Theme is removed from the persistent topbar.
8. Phone topbar actions collapse into `...`, with only `Copy session ID` in the current phase.
9. Reading surfaces no longer default to a light, muted, `text-sm` voice.
10. Long-form reading blocks are easier to read without being wrapped in cards.

## Summary

The main shift in this spec is simple:

stop treating the workspace as a collection of dark cards,
and start treating it as a stable control surface with a strong reading system.

That is the whole game.
