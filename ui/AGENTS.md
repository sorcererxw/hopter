# UI AGENTS

This file governs `ui/**` and overrides the repo `AGENTS.md` for UI work.

## Shell Posture Contract

The workspace shell has exactly three semantic postures:

- `phone`: `< 640px`
- `compact`: `640px - 1023px`
- `wide`: `>= 1024px`

Responsive posture belongs to the workspace shell, not routes or leaf
components.

Allowed owners:

- `ui/src/components/app/workspace-layout.tsx`
- shared posture helpers used by that shell
- `WorkspaceShellContext`

Do not let route files, topbar, rail, detail pane, or inspector pane invent
private breakpoint truth.

## Shell Behavior

- `/` on `phone` shows the session list.
- `/sessions/:sessionId` on `phone` shows session detail with an in-app Back
  action that navigates to `/`.
- `compact` and `wide` keep one shell; the rail is inline, not a drawer.
- Session switching must not automatically collapse the rail.
- Inspector visibility must follow shell posture.

Use semantic names such as `posture`, `railVisible`, and `toolbarMode`. Avoid
overlay-specific names such as `sidebarOpen` when the state applies across
postures.

## UI System

Follow `docs/operations/UI_SYSTEM_RULES.md`
for HeroUI, tokens, typography, and workspace hierarchy rules.

Generated Buf / Connect TypeScript under `ui/src/gen/**` is not edited by hand.
Regenerate it from `idl/**`.

## Copy And I18n

Stable UI copy must go through `react-i18next`.

- Add user-facing strings to `ui/src/lib/i18n/messages.ts`.
- Keep English and `zh-CN` entries in sync.
- Do not translate Codex transcript bodies, user prompts, agent output, command
  output, file paths, model names, skill names, backend diagnostics, brand
  names, protocol constants, HTTP methods, or keyboard key names.

## Validation

Any shell change that touches breakpoints must produce evidence for:

- phone list
- phone detail
- compact rail hidden
- compact rail visible
- wide rail visible
- wide rail hidden

Evidence should include screenshots and at least one interaction proof for phone
back behavior, compact rail expand/collapse, and wide toolbar persistence.
