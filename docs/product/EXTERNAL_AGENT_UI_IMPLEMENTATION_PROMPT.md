# External Agent UI Implementation Prompt

Use the following prompt with an external agent that does not share local Codex context.

```text
You are working in this repository:

/Users/sorcererxw/repo/sorcererxw/codeshell

Before making changes, read and follow these files:

- /Users/sorcererxw/repo/sorcererxw/codeshell/AGENTS.md
- /Users/sorcererxw/repo/sorcererxw/codeshell/docs/README.md
- /Users/sorcererxw/repo/sorcererxw/codeshell/docs/product/UI_REBUILD_DESIGN_DOC.md
- /Users/sorcererxw/repo/sorcererxw/codeshell/docs/product/WORKSPACE_UI_REFINEMENT_SPEC.md
- /Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/UI_SYSTEM_RULES.md

Task:
Implement the approved workspace UI refinement spec from WORKSPACE_UI_REFINEMENT_SPEC.md.

Important constraints:
- Do NOT modify shadcn primitives in `ui/src/components/ui/*` unless absolutely necessary.
- Prefer changes in app-layer components and `ui/src/index.css`.
- Keep the product as a workspace shell, not a dashboard, not a landing page, not a mobile IDE.
- Keep `Geist Variable + JetBrains Mono`.
- Follow Tailwind/shadcn token rules from AGENTS.md. Avoid random hard-coded values unless truly necessary.
- Completion requires validation evidence. Do not claim “done” without running validation and reporting evidence paths.

Primary files likely to change:
- /Users/sorcererxw/repo/sorcererxw/codeshell/ui/src/index.css
- /Users/sorcererxw/repo/sorcererxw/codeshell/ui/src/components/app/workspace-topbar.tsx
- /Users/sorcererxw/repo/sorcererxw/codeshell/ui/src/components/app/session-composer.tsx
- /Users/sorcererxw/repo/sorcererxw/codeshell/ui/src/components/app/session-rail.tsx
- /Users/sorcererxw/repo/sorcererxw/codeshell/ui/src/components/app/session-detail-pane.tsx
- /Users/sorcererxw/repo/sorcererxw/codeshell/ui/src/components/app/session-rich-text.tsx
- Possibly related route/layout files if needed for phone-vs-large-screen behavior

Implement these approved decisions:

1. Overall structure
- Phone portrait: thread list is the entry page; a thread is its own page.
- Large screens, including iPad landscape: persistent left sidebar + right workspace.
- Composer is fixed to the bottom on all screen classes.
- Main content scrolls behind the composer.
- Composer must read as a clear foreground layer.

2. Topbar
- Large screens:
  - Left side: thread title + project name inline + `...` overflow trigger.
  - Right side only: `Commit` button, terminal placeholder icon button, right-side panel toggle icon button.
- `Commit` button opens a popup with exactly:
  - Commit
  - Review
  - Commit & Review
- Theme is removed from the persistent topbar.
- Desktop and large touch screens: settings opens a popup with:
  - quick dark mode toggle
  - navigate to `/settings`
- Phone topbar:
  - Left: back button to thread list, then two-line title stack:
    - thread title
    - project name
  - Right: a single `...` menu button
  - Phone `...` menu should currently contain only:
    - Copy session ID

3. Rail
- Thread rows should show only:
  - status icon
  - title
  - relative last-active time
- Remove always-visible project name, backend tag, full path, and expandable metadata from rail rows.

4. Empty state
- Remove the three starter prompt cards entirely.
- Keep the shell as a chat-first empty state.

5. Composer
- Keep the two-row structure.
- Send is the dominant primary action, especially on small screens.
- `+` remains visible, but clearly secondary.
- Model selector and reasoning selector become ghost buttons.
- Selector interaction:
  - desktop: dropdown/pop menu
  - small screens: bottom sheet
- Lower metadata row stays lighter than the main action row.

6. Touch behavior
- Do NOT solve touch by globally scaling the whole UI.
- Prioritize:
  - grouping
  - spacing
  - layout
  - then target size refinement
- Large touch screens should use desktop structure with touch-friendly spacing/targets.

7. Surface language
- Reduce soft card-heavy styling.
- Use fewer `rounded-2xl` surfaces.
- Prefer a tighter visual language with more `rounded-lg` / `rounded-md`.
- Avoid card-inside-card feel.

8. Typography and reading system
- Keep `Geist Variable + JetBrains Mono`.
- Raise the global readable body baseline toward `text-base`.
- Primary reading surfaces should default to at least `font-medium`.
- Sharply reduce misuse of `text-muted-foreground`.
- Use muted only for truly secondary metadata.
- Improve `SessionRichText` so it becomes reading-first, not just a minimal markdown renderer.
- Do not rely only on markdown `**strong**` for hierarchy.
- Better distinguish:
  - normal chat messages
  - long-form summaries/explanations
  - status/artifact/system surfaces
- Do NOT solve long-form readability by wrapping everything in cards.
- Distinguish long reading blocks through typography, spacing, rhythm, and light separators.

Acceptance criteria:
- Empty state has no starter prompt cards.
- Rail shows only status, title, and relative time.
- Topbar behavior differs correctly between phone and large screens.
- Composer is fixed-bottom on all screens and visually foregrounded.
- Send is clearly dominant.
- Model/reasoning controls are ghost buttons and use device-appropriate reveal behavior.
- Theme is gone from persistent topbar.
- Phone topbar uses a single `...` with only “Copy session ID”.
- Reading surfaces no longer feel light, blurry, or over-muted.
- Long-form reading blocks are easier to read without becoming cards.

Validation requirements:
- Use the repo’s live dev loop instructions from AGENTS.md and DEV_LOOP.md.
- Prefer:
  - `make reset`
  - `make dev`
  - `make verify-live`
- Read machine state from:
  - /Users/sorcererxw/.orchd/devlogs/codeshell/state.json
- Read logs from:
  - /Users/sorcererxw/.orchd/devlogs/codeshell/timeline.jsonl
- Validate both large-screen and phone-like layouts.
- Report concrete evidence paths and commands run.

Deliverable:
- Implement the changes.
- Summarize what changed by file.
- Report validation commands run.
- Report evidence paths.
- Note any remaining risks or unfinished items explicitly.
```
