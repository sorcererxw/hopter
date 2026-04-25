# UI AGENTS

This file adds UI-specific implementation rules for everything under `/ui`.

These rules refine the root [`AGENTS.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/hopter/AGENTS.md). If they conflict, this file wins for `ui/**`.

## Breakpoint architecture

The workspace shell uses **three semantic postures**. Do not reintroduce route-local or component-local breakpoint truth.

### Postures

1. `phone`
   - width: `< 640px`
   - target devices: phone portrait
   - shell behavior:
     - thread list is the entry page
     - thread detail is a second-level page
     - top-left toolbar action is `Back`

2. `compact`
   - width: `640px - 1023px`
   - target devices: phone landscape, tablet portrait
   - shell behavior:
     - one shell, collapsible left rail
     - expanded rail is inline, like desktop, not a drawer
     - rail hidden: desktop toolbar mode
     - rail visible: mobile toolbar mode
     - top-left toolbar action is rail toggle
     - thread switching must not automatically collapse the rail

3. `wide`
   - width: `>= 1024px`
   - target devices: tablet landscape, laptop, desktop
   - shell behavior:
     - one shell
     - desktop toolbar mode
     - left rail is visible by default but can be hidden
     - top-left toolbar action is rail toggle
     - thread switching must not automatically collapse the rail

## Ownership rules

### Shell truth

Responsive posture belongs to the workspace shell.

Allowed owner:

- `ui/src/components/app/workspace-layout.tsx`
- shared posture helper(s) used by that shell
- `WorkspaceShellContext`

Do not let these files invent their own shell breakpoint truth:

- route files
- `workspace-topbar.tsx`
- `session-detail-pane.tsx`
- `session-inspector-pane.tsx`
- `session-rail.tsx`

### Naming

Use semantic names:

- `posture`
- `railVisible`
- `toolbarMode`

Avoid overlay-specific names such as `sidebarOpen` once the same state applies to compact and wide shells.

## Route rules

- `/` on `phone` shows the thread list, not the home workspace pane.
- `/sessions/:sessionId` on `phone` shows the detail page with a back action.
- Non-phone routes keep the same URL model. The shell changes, not the route tree.

## Back behavior

Phone detail back action must:

1. navigate to `/`
2. reliably return the user to the thread list

Do not wire the phone back button to browser-history semantics. In this product, the phone detail back button is an in-app return to the thread list.

## Inspector rules

- Inspector visibility must follow shell posture, not a private `lg:` breakpoint.
- If inspector is wide-only, gate it from shell posture and keep the component itself breakpoint-agnostic.

## Validation rules

Any shell change that touches breakpoints must produce evidence for all of these:

1. phone list
2. phone detail
3. compact rail hidden
4. compact rail visible
5. wide rail visible
6. wide rail hidden

The evidence should include screenshots and at least one interaction proof for:

- phone back behavior
- compact rail inline expand / collapse behavior
- desktop toolbar persistence in wide mode

## Typography rules

These rules apply to `ui/**` unless a file has a clear, local semantic reason to differ.

### Font families

- Default UI and reading font is `Geist`.
- Use mono only for actual code semantics:
  - inline code in rich text
  - code blocks
  - command output
  - logs
- Do not switch a label, path, or link to mono just because it "looks technical". If it behaves like normal UI text, keep the UI font.

### Ownership

- Prefer putting text size and font weight on the nearest meaningful container.
- Do not repeat `text-sm` / `text-base` / `font-medium` on child nodes when the parent already establishes the same baseline.
- Keep local overrides only when the child truly has different semantics, for example:
  - metadata
  - section labels
  - page titles
  - inline code
  - code containers

### Size scale

- `text-2xl`: page-level titles
- `text-base`: reading surfaces, primary input text, main body copy
- `text-sm`: standard controls, rows, dialogs, secondary panes
- `text-xs`: metadata, timestamps, compact labels, uppercase section markers

Avoid ad hoc sizes in app-layer code.

### Weight scale

- Default readable UI baseline should be `font-medium` where the surface is meant to be actively read.
- Use normal inherited weight for child text when the container already carries `font-medium`.
- Reserve heavier emphasis for real semantic emphasis only. Do not stack extra `font-medium` on children just to make them "feel clearer".

### Inline code

- Rich-text inline code must use the dedicated inline-code treatment:
  - mono
  - `text-sm`
  - muted gray chip background
- Reuse the existing inline-code styling instead of inventing per-component variants.

### Code containers

- Reuse a shared code-container owner for block code where practical.
- Keep technical density decisions local to the owning surface when needed, but do not fork font family, base size, border, and spacing rules without a reason.

## Tailwind usage note

For shell posture, do not assume Tailwind default `md` means "tablet/desktop boundary".

The intended shell split is:

- `< sm` => `phone`
- `sm - lg` => `compact`
- `>= lg` => `wide`

Local control widgets may still use their own breakpoints when justified, but shell behavior must not depend on those local rules.

## UI copy and i18n

Stable UI copy must go through `react-i18next`.

- Add user-facing strings to `ui/src/lib/i18n/messages.ts`.
- Render stable UI copy with `t("...")` from `useTranslation()`.
- Keep English and `zh-CN` entries in sync when adding or renaming keys.
- Do not translate Codex transcript bodies, user prompts, agent output, command output, file paths, model names, skill names, backend diagnostics, brand names, protocol constants, HTTP methods, or keyboard key names.
- Components that cannot call React hooks should return structured state or codes and let the rendering layer translate them.

Lint enforces this for JSX text in app-layer code with the stock ESLint `no-restricted-syntax` rule. Do not add a custom i18n scanner unless the lint rule proves insufficient.

Generated Buf / Connect TypeScript under `ui/src/gen/**` is not edited or linted by hand. Regenerate from `idl/**` and keep app code using the generated clients/types.
