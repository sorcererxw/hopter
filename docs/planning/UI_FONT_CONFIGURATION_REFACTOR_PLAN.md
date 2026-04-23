<!-- /autoplan restore point: /Users/sorcererxw/.gstack/projects/unknown/master-autoplan-restore-20260418-153359.md -->
# UI Font Configuration Refactor Plan

## Status

- status: reviewed draft
- branch: `master`
- owner: `autoplan`
- scope: `ui/**`
- request: unify the product around two fonts only

## Problem Statement

The repo already imports `Geist Variable` and `JetBrains Mono`, but the actual UI does not behave like a two-font system.

Today the problems are specific:

1. `ui/src/routes/settings-route.tsx` still advertises `Inter` as the interface font, which is false.
2. Mono surfaces are inconsistent across transcript code blocks, tool payloads, command payloads, inspector diffs, and the terminal drawer. They swing between `text-xs`, `text-sm`, and ad hoc `text-[0.92em]`.
3. Reading surfaces already moved toward `text-base` and `font-medium`, but that rule is not expressed as a reusable typography system. It lives in scattered class strings.
4. The project has no semantic typography utilities that distinguish:
   - UI reading copy
   - inline code / command chips
   - block code / logs / terminal output
   - low-emphasis mono metadata
5. Composer-adjacent technical surfaces still carry their own mono typography and would remain inconsistent if this pass ignores them.

The result is a UI that technically uses the right fonts but still feels visually inconsistent and hard to maintain.

## User Outcome

After this refactor, the user should feel one coherent typographic voice:

- all normal UI and reading surfaces default to `Geist`, `text-base`, `font-medium`
- all code-like surfaces default to `JetBrains Mono`, with density preserved per surface unless a local size is clearly ad hoc
- mono weight changes only when meaning changes, not because the component happened to choose a random size last month
- settings reflect reality instead of stale placeholder values

## Constraints

1. Follow the UI refinement spec: keep `Geist Variable + JetBrains Mono`.
2. Do not mutate `ui/src/components/ui/*` primitives unless there is a true primitive bug.
3. Prefer shadcn and workspace tokens over ad hoc values.
4. Keep the change in the font/typography blast radius. This is not a visual redesign.
5. Validation must produce evidence, not just a code diff.

## Premise Challenge

### Premise 1

The right problem is not "pick better fonts." That decision is already made in [`docs/product/WORKSPACE_UI_REFINEMENT_SPEC.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/hopter/docs/product/WORKSPACE_UI_REFINEMENT_SPEC.md).

Verdict: accepted.

### Premise 2

The right implementation shape is not one more round of local class-string edits. The repo needs one explicit typography adoption strategy so future features inherit the same rules and validation can catch drift.

Verdict: accepted.

### Premise 3

The highest-value blast radius is the workspace UI, especially transcript, inspector, composer-adjacent command surfaces, terminal, and settings.

Verdict: accepted.

### Premise 4

This refactor should not expand into component primitive redesign, terminal behavior changes, or a new theme system.

Verdict: accepted.

## What Already Exists

| Sub-problem | Existing code | Reuse plan |
|---|---|---|
| Font imports and family tokens | `ui/src/index.css` | Keep imports, centralize semantic typography utilities here |
| Reading-first transcript copy | `ui/src/components/app/session-rich-text.tsx` | Reuse its `text-base leading-7 font-medium` baseline as the default reading rule |
| Terminal mono surface | `ui/src/features/terminal/terminal-drawer.tsx` | Normalize the xterm wrapper to the shared mono block rule |
| Transcript payload blocks | `ui/src/components/app/session-detail-pane.tsx` | Replace duplicated `pre` class strings with shared mono utilities |
| Inspector technical surfaces | `ui/src/components/app/session-inspector-pane.tsx` | Normalize labels, payload lines, and file paths through shared mono utilities |
| Composer-adjacent mono labels | `ui/src/components/app/session-composer.tsx` | Normalize skill command markers and reference labels through the shared mono rules |
| Product typography intent | `docs/product/WORKSPACE_UI_REFINEMENT_SPEC.md` | Treat as the design source of truth |
| Settings copy | `ui/src/routes/settings-route.tsx` | Update visible font values to match reality |

## Dream State Mapping

```text
CURRENT
  Imports are correct, usage is scattered
  Mono sizing varies by component
  Reading rules are implicit
  Settings page lies about the UI font

THIS PLAN
  One typography owner in ui/src/index.css
  One semantic rule for UI reading surfaces
  One semantic rule for code semantics, without forcing one density on all technical surfaces
  One semantic rule for inline code and mono metadata
  Settings copy reflects the real font system

12-MONTH IDEAL
  New UI work consumes semantic typography utilities by default
  Transcript, inspector, terminal, search, settings, and future artifacts inherit the same system
  Typography changes become token edits plus validation-backed discipline, not hunt-and-peck class churn
```

## Implementation Alternatives

| Approach | Effort | Pros | Cons | Verdict |
|---|---:|---|---|---|
| A. Patch every component inline | low | Fast initial diff | Locks inconsistency into more class strings, hard to maintain | reject |
| B. Add semantic typography utilities in `ui/src/index.css`, migrate affected components, and add a drift inventory check | medium | Explicit, low-risk, future-proof, matches repo pattern | Slight upfront naming work plus one validation rule | accept |
| C. Push typography into `ui/src/components/ui/*` primitives | medium-high | Centralizes some defaults | Violates UI guardrail, too wide for this blast radius | reject |

## Accepted Scope

1. Add a semantic typography layer in `ui/src/index.css`.
2. Standardize reading surfaces on `Geist`, `text-base`, `font-medium`.
3. Standardize code / command / log / terminal surfaces on `JetBrains Mono`, but preserve existing dense surfaces unless the size is clearly arbitrary or inconsistent.
4. Standardize inline code and low-emphasis mono metadata through shared utility classes.
5. Update visible settings labels so the product reports `Geist` and `JetBrains Mono`.
6. Touch every current owner of duplicated mono transcript/terminal/composer typography inside the app layer.
7. Add a repo inventory check so ad hoc mono sizing does not creep back in.

## Deferred To TODOS.md

1. Audit the entire settings surface for placeholder values beyond fonts.
2. Consider a follow-up pass to reduce overuse of `text-muted-foreground` outside the font refactor blast radius.
3. Consider screenshot regression coverage dedicated to typography hierarchy once the terminal stack stabilizes.

## NOT In Scope

1. Replacing the actual font families.
2. Redesigning the terminal feature or transcript information architecture.
3. Editing shadcn primitives for style preference only.
4. Theme token changes unrelated to typography.
5. Backend, Connect, SSE, or Codex runtime behavior.

## CEO Review

### 0A. Premise Challenge

This request is scoped correctly. It improves the thing the user actually reads every day and removes maintenance debt that will otherwise keep leaking into every workspace change. It is not a vanity polish pass.

The only strategic risk is letting the task grow into "global readability redesign." That is the trap. The right move is to tighten typography ownership without reopening layout, spacing, density, or color unless a local value is obviously arbitrary.

### 0B. Existing Code Leverage

The repo already contains the correct font imports and an approved product spec that calls for `text-base` plus `font-medium` on reading surfaces. This means the work is not inventing a new system, it is converging the implementation onto an existing decision.

### 0C. Dream State Delta

If we do nothing, every new transcript or inspector enhancement keeps copying one-off font decisions. Six months later, font cleanup becomes harder because the inconsistency is distributed across more surfaces. This plan avoids that slow rot by establishing shared rules plus a validation backstop now.

### 0C-bis. Implementation Alternatives

Approach B wins because it solves today's mismatch and tomorrow's drift with one move. Approach A is the classic "faster until it isn't" answer. Approach C is too wide and would drag the entire primitive layer into a style migration for no real user benefit.

### 0D. Mode Selection

Mode: SELECTIVE EXPANSION.

Reasoning:

- complete the font refactor blast radius
- do not expand into unrelated UI redesign
- allow small scope growth when duplicated typography owners are directly touched

### 0E. Temporal Interrogation

Hour 1:
- add semantic typography utilities
- migrate transcript and terminal owners

Hour 2:
- migrate inspector and settings owners
- clean remaining obvious mono duplication in app-layer surfaces

Hour 3:
- validate through build plus live screenshots for transcript, terminal, inspector, settings

Hour 6+ regret if skipped:
- new workspace surfaces keep hard-coding font rules
- settings continue to claim the wrong UI font

### 0F. Scope Decision

Approve the whole font-system convergence inside the app-layer blast radius. Do not split this into a pilot. But keep it a convergence task, not a disguised density redesign.

### Error & Rescue Registry

| Risk | User impact | Rescue |
|---|---|---|
| Over-centralized utility names are too vague | contributors misuse utilities and drift returns | use explicit names tied to reading, inline code, mono block, mono meta |
| Terminal text density changes accidentally | terminal becomes harder to scan or overflows vertically | preserve dense technical surfaces unless the current size is clearly arbitrary; verify terminal viewport density in live validation |
| Settings copy changes but implementation misses a surface | product still feels inconsistent | run an inventory pass on all `font-mono` owners in app-layer files before closing |
| Shared rules get added but local ad hoc values remain | the refactor looks done while drift persists | add a grep-based validation rule for disallowed ad hoc typography patterns |

### Failure Modes Registry

| Failure mode | Severity | Preventive action |
|---|---|---|
| Shared utility not used by transcript payload blocks | high | replace duplicated `pre` class strings during the same pass |
| Shared utility leaks into non-code metadata that should stay UI font | medium | separate mono block vs mono meta utilities |
| Font values in settings drift again later | medium | make settings read from shared constants or at minimum update the displayed value in the same refactor |
| The plan silently changes density on terminal or code-frame surfaces | high | record density-preserving rules explicitly in scope and validate them in screenshots |

## Design Review

### Scope Assessment

UI scope: yes.

This is a typography-system task, so design review is mandatory even though layout is not changing.

### Pass 1: Information Architecture

Score: 8/10.

The plan keeps the visual hierarchy simple: reading surfaces stay in the UI font, technical payloads move to the code font, and settings tell the truth. Good. The remaining gaps are naming the utilities clearly enough that later contributors do not guess, and distinguishing family convergence from density changes.

### Pass 2: Interaction State Coverage

Score: 8/10.

The important states are transcript reading, command payload expanders, tool payload expanders, inspector technical panels, terminal output, and composer-adjacent skill surfaces. The plan covers almost all of them. It should explicitly verify both collapsed and expanded transcript states so hidden payload blocks are not missed.

### Pass 3: User Journey And Emotional Arc

Score: 8/10.

This matters because the product's daily feeling comes from long reading sessions. Consistent reading weight plus stable mono blocks makes the workspace feel more deliberate. The emotional miss would be a terminal or payload surface suddenly feeling oversized and noisy, so validation must compare density before and after instead of assuming `text-base` is always the answer.

### Pass 4: AI Slop Risk

Score: 9/10.

The plan avoids the classic AI slop move of inventing a dozen utility names that all mean almost the same thing. Keep the utility set small and behavior-specific.

### Pass 5: Design System Alignment

Score: 9/10.

This plan aligns directly with the approved refinement spec. It uses semantic utilities and standard Tailwind tokens instead of arbitrary values. Good.

### Pass 6: Responsive And Accessibility

Score: 8/10.

Typography changes must be checked on phone and wide postures because transcript density and terminal readability behave differently across widths. No accessibility blocker is apparent, but live screenshots should confirm readable hierarchy on narrow screens.

### Pass 7: Unresolved Design Decisions

Score: 7/10.

Resolved taste choice: inline code uses `text-sm`, one step smaller than body copy. Remove the current `0.92em` ad hoc scale and replace it with the standard token. Do not introduce another percentage-based special case.

### Design Completion Summary

The design risk is low. The main rule is: centralize typography, do not overdesign it.

## Engineering Review

### Step 0: Scope Challenge

The code analysis says this is a concentrated UI-only change with obvious owners:

- `ui/src/index.css`
- `ui/src/components/app/session-rich-text.tsx`
- `ui/src/components/app/session-detail-pane.tsx`
- `ui/src/components/app/session-inspector-pane.tsx`
- `ui/src/components/app/session-composer.tsx`
- `ui/src/features/terminal/terminal-drawer.tsx`
- `ui/src/routes/settings-route.tsx`
- any additional app-layer surfaces still duplicating mono typography after the first sweep

That is a healthy blast radius. No need to reduce scope.

### 1. Architecture Review

The clean structure is:

```text
ui/src/index.css
  ├─ typography utility owners
  │   ├─ ui reading
  │   ├─ mono inline
  │   ├─ mono block
  │   └─ mono meta
  ├─ SessionRichText
  ├─ SessionDetailPane payload blocks
  ├─ SessionInspectorPane technical surfaces
  ├─ SessionComposer command/skill metadata
  ├─ TerminalDrawer xterm wrapper
  └─ SettingsRoute display values
```

This is explicit, easy to read, and keeps ownership in one place. It also avoids pushing app-specific typography decisions into shared primitives.

### 2. Code Quality Review

The current repo duplicates the same `font-mono` plus small-size combo across multiple files. That is the maintainability bug.

The implementation should replace duplication with a minimal utility vocabulary, not with a TypeScript helper that concatenates class names from code. CSS is the right owner here because the concern is typography semantics, not component state. But CSS utilities alone are not enough, so the validation lane needs a repo inventory check that fails on the disallowed ad hoc patterns.

### 3. Test Review

#### Test Diagram

| Surface | Code path | Expected coverage |
|---|---|---|
| Assistant prose | `ui/src/components/app/session-rich-text.tsx` | visual/manual validation through transcript screenshot |
| Inline code | `ui/src/components/app/session-rich-text.tsx` | visual/manual validation in transcript screenshot |
| Fenced code blocks | `ui/src/components/app/session-rich-text.tsx` | visual/manual validation in transcript screenshot |
| Tool and command payload blocks | `ui/src/components/app/session-detail-pane.tsx` | visual/manual validation in expanded transcript states |
| Inspector code-like values | `ui/src/components/app/session-inspector-pane.tsx` | visual/manual validation in inspector open state |
| Composer skill/query labels | `ui/src/components/app/session-composer.tsx` | visual/manual validation in the skill suggestion surface |
| Terminal output | `ui/src/features/terminal/terminal-drawer.tsx` | live validation in terminal open state |
| Font labels in settings | `ui/src/routes/settings-route.tsx` | route screenshot plus text assertion |

#### Test Gaps

There is no dedicated automated typography test today. That is acceptable for this pass because the risk is visual and localized, but it increases the importance of screenshot evidence and a grep-based drift inventory.

#### Validation Commands

1. `pnpm --dir ui build`
2. `make verify-live`
3. `rg -n 'text-\\[0\\.92em\\]' ui/src`
4. `rg -n 'font-mono' ui/src/components/app ui/src/features ui/src/routes`
5. Route-level screenshot evidence for:
   - transcript with prose + inline code + fenced block
   - terminal drawer open
   - inspector open
   - composer skill suggestion surface
   - settings appearance section

### 4. Performance Review

No meaningful runtime risk. This is static typography configuration plus class cleanup.

### 5. Security Review

No new attack surface. Static font classes only.

### 6. Deployment Review

Low deployment risk. The only rollback concern is unreadable density on technical surfaces, which validation should catch before merge.

### Engineering Completion Summary

The implementation should stay boring. Central CSS owner, small blast radius, strong visual verification.

## DX Review

Skipped. This task changes product UI typography, not developer-facing API or onboarding.

## Cross-Phase Themes

1. Shared rules need a validation backstop or drift returns.
2. Keep the blast radius tight to app-layer typography surfaces.
3. The highest-risk surfaces are transcript payload blocks, composer skill labels, and terminal output, not ordinary buttons.

## Outside Voice Summary

Source: codex-only.

Integrated findings:

1. Do not silently turn this into a density redesign. Preserve dense technical surfaces unless a size is clearly arbitrary.
2. The original scope missed `session-composer.tsx`, which would have left visible inconsistency behind.
3. CSS utilities alone do not prevent future drift. Pair them with a grep-based inventory check.
4. The stale `Inter` label is a real truth bug and remains part of the scope.

## Validation Evidence Plan

The implementation is not complete until evidence exists for:

1. `pnpm --dir ui build` succeeds
2. transcript screenshot shows:
   - Geist reading body at `text-base`
   - mono inline code
   - mono fenced block
3. terminal screenshot shows shared mono typography without accidental density regression
4. inspector screenshot shows code-like values and payload lines using the shared mono system
5. composer screenshot shows skill/query mono labels using the shared mono system
6. settings screenshot shows `Geist` as interface font and `JetBrains Mono` as code font
7. repo inventory shows:
   - no remaining `text-[0.92em]` in app code
   - remaining raw `font-mono` usages are expected and documented

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 1 | CEO | Treat this as a system convergence task, not font exploration | mechanical | completeness | the repo already chose the font families | replacing fonts |
| 2 | CEO | Use selective expansion inside the app-layer typography blast radius | taste | boil lakes | all duplicated owners directly touched should converge in one pass | pilot-only pass |
| 3 | Design | Keep typography ownership in CSS utilities, not component-local strings | mechanical | explicit over clever | the concern is semantic typography, not component state | TS helper abstraction |
| 4 | Design | Do not modify shadcn primitives unless a real bug appears | mechanical | pragmatic | matches repo guardrail and limits blast radius | primitive-layer refactor |
| 5 | Eng | Normalize terminal, transcript payloads, inspector, and composer together | taste | choose completeness | these are the visible mono surfaces users read together | settings-only or transcript-only patch |
| 6 | Eng | Preserve density on technical surfaces unless a local size is clearly arbitrary | taste | pragmatic | convergence should not silently become a readability redesign | force `text-base` everywhere |
| 7 | Eng | Add a grep-based inventory check beside screenshots | mechanical | explicit over clever | screenshots show looks, grep shows drift | screenshot-only validation |
| 8 | User override | Inline code uses `text-sm`, one step below body copy | taste | user sovereignty | explicit user preference, still uses a standard token and removes ad hoc sizing | inline code inherits body size |

## Completion Summary

| Review | Status | Key Result |
|---|---|---|
| CEO | pass with scope guard | do the whole typography blast radius, but keep it a convergence task, not a density redesign |
| Design | pass with user override applied | keep utility names explicit and set inline code to `text-sm` |
| Engineering | pass with codex concern integrated | central CSS owner plus focused UI validation and drift checks is the right implementation shape |
| DX | skipped | no developer-facing scope |

## Implementation Checklist

- [ ] add semantic typography utilities in `ui/src/index.css`
- [ ] update `SessionRichText` to consume shared mono inline/block utilities
- [ ] update transcript payload `pre` blocks in `session-detail-pane.tsx`
- [ ] update inspector technical surfaces in `session-inspector-pane.tsx`
- [ ] update composer-adjacent mono labels in `session-composer.tsx`
- [ ] update terminal mono surface in `terminal-drawer.tsx`
- [ ] update settings font labels in `settings-route.tsx`
- [ ] preserve dense technical surfaces unless a local size is clearly ad hoc
- [ ] add repo inventory checks for ad hoc mono sizing
- [ ] run build + live validation
- [ ] record evidence path
