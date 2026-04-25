<!-- /autoplan restore point: local gstack project artifact -->
# Breakpoint Architecture Redesign Plan

Date: 2026-04-17
Branch: master
Status: reviewed
Mode: SELECTIVE_EXPANSION

## Plan Summary

This plan replaces the current mixed breakpoint behavior with one semantic shell model:

1. `phone` (`< 640px`): thread list and thread detail are separate pages.
2. `compact shell` (`640px <= width < 1024px`): one shell, collapsible left rail, toolbar mode depends on whether the rail is consuming the viewport. When visible, the rail is inline like desktop, not a drawer.
3. `wide shell` (`>= 1024px`): one shell, desktop toolbar, left rail can be shown or hidden without changing the route model.

The key fix is to stop letting route logic, sidebar logic, and topbar logic each pick their own breakpoint. The shell becomes the source of truth for responsive posture.

Designer note: this does **not** map cleanly to Tailwind default `sm/md/lg` names if we keep `md = 768`. The intended device split is:

- phone portrait: `< 640px`
- phone landscape / tablet portrait: `640px - 1023px`
- tablet landscape / desktop: `>= 1024px`

So the implementation should use semantic posture thresholds, or equivalently `sm` + `lg`, not default `sm` + `md`.

## User request

重新设计整体的 breakpoint 架构：

- `< sm` 时，thread 页面里会话详情改为二级页面
- `< sm` 时，toolbar 左上角是返回按钮
- `> sm` 时，toolbar 左上角是展开/隐藏左侧 sidebar 的按钮
- 在 `sm-md` 之间，展开 sidebar 时 toolbar 使用手机模式
- 在 `sm-md` 之间，收起 sidebar 时 toolbar 使用桌面模式

## Scope Detection

- UI scope: yes
- DX scope: yes
- Backend / IDL scope: no API change required

## Phase 0, Intake + Current State

### Current observed contradictions

The current UI is not using one breakpoint architecture.

1. `ui/src/routes/home-route.tsx` splits phone vs desktop at `md`.
2. `ui/src/components/app/workspace-layout.tsx` splits drawer vs persistent rail at `lg`.
3. `ui/src/components/app/workspace-topbar.tsx` splits phone vs desktop toolbar at `lg`.
4. `ui/src/components/app/session-composer.tsx` already uses `md` as the interaction breakpoint for bottom sheet vs dropdown.
5. `ui/src/components/app/session-inspector-pane.tsx` is independently gated by `lg`.
6. `ui/src/routes/home-route.tsx` renders its own phone rail, while `WorkspaceLayout` also owns rail chrome.

That means the app currently has at least three responsive truth systems:

- route-level truth at `md`
- shell-level truth at `lg`
- composer control truth at `md`

In practice, this creates the exact awkward zone the user called out: between `sm` and `md`, and also between `md` and `lg`, the page can be in one navigation mode while the toolbar still thinks it is in another.

### What already exists

| Sub-problem | Existing code | Keep or replace |
|---|---|---|
| Shell open / close state | `ui/src/components/app/workspace-layout.tsx`, `ui/src/components/app/workspace-shell-context.tsx` | keep, but make it semantic instead of `lg`-hardcoded |
| Phone-vs-desktop route split | `ui/src/routes/home-route.tsx` | replace, because it is currently keyed to `md` instead of semantic shell posture |
| Thread detail toolbar | `ui/src/components/app/workspace-topbar.tsx` | keep component, replace breakpoint logic |
| Left rail | `ui/src/components/app/session-rail.tsx` | keep component, adapt containment behavior |
| Session workspace | `ui/src/components/app/session-detail-pane.tsx` | keep page semantics, adapt shell entry behavior |
| Inspector pane | `ui/src/components/app/session-inspector-pane.tsx` | keep surface, replace `lg` ownership with shell posture |
| Composer interaction density | `ui/src/components/app/session-composer.tsx` | keep `md` picker behavior, align with new shell posture |

### Premises

1. The product job on phone is monitor, steer, approve, and resume. Not deep side-by-side browsing.
2. The shell, not the route file, should own responsive posture.
3. Toolbar mode should be derived from available workspace width and shell state, not only viewport width.
4. The session rail can be hidden on wider screens without turning the selected session into a different route type.
5. We should not change backend contracts for this redesign.
6. Naming must describe meaning. `sidebarOpen` is not the right long-term name once the same state covers both compact inline visibility and wide-shell rail visibility.
7. The user's intended device classes match `phone < 640`, `compact 640-1023`, `wide >= 1024`, not Tailwind default `phone < md`, `wide >= md`.

### Premise challenge

- Premise 1 is valid and reinforced by `docs/product/WORKSPACE_UI_REFINEMENT_SPEC.md`.
- Premise 2 is required. The current split-brain breakpoints are the root defect.
- Premise 3 is the crucial new rule. Without it, `sm-md` can never behave the way the user asked.
- Premise 4 is reasonable and keeps `> sm` behavior consistent with the user request.
- Premise 5 is correct. This is entirely a shell/layout/UI-state refactor.
- Premise 6 is important. If we keep `sidebarOpen`, the code will keep leaking overlay assumptions into wide-shell behavior.
- Premise 7 is critical. Using Tailwind default `md = 768` as the wide-shell cutoff would wrongly place most tablet portrait devices into wide mode.

### Existing code leverage map

| Sub-problem | Existing asset | Reuse strategy |
|---|---|---|
| Canonical shell state | `WorkspaceShellContext` | extend with semantic posture + rail visibility state |
| Rail rendering | `SessionRail` | keep navigation semantics, change only containment and action affordances |
| Detail rendering | `SessionWorkspacePane` | keep status / summary / attention / transcript / composer order |
| Topbar | `WorkspaceTopbar` | convert from breakpoint-only rendering to mode-driven rendering |
| Route back behavior | `SessionRoute`, `WorkspaceTopbar` | make phone back deterministic to `/` for true second-level phone detail |
| Composer responsive pickers | `SessionComposer` | leave picker breakpoint at `md`, align only shell spacing and bottom inset behavior |

### Dream state diagram

```text
CURRENT
  route mode uses md
  shell mode uses lg
  topbar mode uses lg
  composer mode uses md
  =>
  mismatched states, especially in compact widths

THIS PLAN
  shell posture defines route, rail, and toolbar behavior
  phone (<640) = separate pages
  compact (640-1023) = inline rail + stateful toolbar mode
  wide (>=1024) = desktop toolbar + rail visibility toggle

12-MONTH IDEAL
  one shell posture service
  container-aware topbar and inspector behavior
  persisted user preference for rail visibility
  responsive validation snapshots for phone / compact / wide
```

### Implementation alternatives

| Approach | What it does | Pros | Cons | Verdict |
|---|---|---|---|---|
| A. Keep current `md` / `lg` split and patch the topbar only | Smallest code diff | Fast | Leaves shell truth fragmented | Reject |
| B. Move everything to default Tailwind `sm/md/lg` viewport names only | Simple mental model | Easy to read | `md = 768` does not match intended tablet split, and still cannot satisfy dynamic toolbar-by-sidebar-state cleanly | Reject |
| C. Introduce semantic shell postures and let toolbar read shell state | Matches request exactly | One source of truth, scalable | Slightly more refactor in shell context | Recommended |

### Temporal interrogation

- Hour 1: centralize shell posture detection and rail visibility state.
- Hour 2-3: rewrite `home-route`, `workspace-layout`, `workspace-topbar` to consume semantic posture.
- Hour 4: adapt `session-detail-pane` and inspector visibility rules.
- Hour 5: add validation coverage for phone, compact-open, compact-closed, and wide.
- Hour 6+: polish edge cases like browser back behavior and rail animation focus order.

### Mode selection confirmation

Selective expansion is the right mode.

We should expand enough to unify the shell truth and the validation strategy. We should not use this request to redesign artifacts, session inspector semantics, or backend data flow.

## Phase 1, CEO Review

### CEO verdict

The right problem is not "pick better Tailwind breakpoints." The right problem is "make the remote workspace feel continuous across device classes." The current build breaks that promise because shell posture is inconsistent.

### Right problem to solve?

Yes, with a refinement: the user asked for breakpoint redesign, but the real deliverable is a semantic shell state model. If we only shuffle `sm`, `md`, and `lg`, the problem comes back on the next feature.

### Scope calibration

Correct with one expansion: add validation posture coverage as part of the redesign. Shipping a new responsive architecture without proof just creates a more elegant regression.

### 6-month regret scenario

If we leave the shell state distributed across route files and components, every new panel, inspector, and overlay will add a fourth or fifth breakpoint truth. Then fixing mobile becomes archaeology.

### Error & Rescue Registry

| Risk | User-visible failure | Rescue |
|---|---|---|
| Route split still keyed to viewport only | phone behavior leaks into compact tablet widths | derive route entry behavior from semantic posture |
| Toolbar mode stays `lg`-hardcoded | compact shell keeps wrong affordances | pass explicit `toolbarMode` prop from shell |
| Rail visibility state only exists for overlay mode | compact and wide screens cannot honor one shared rail model | make rail visibility cross-posture state |
| Browser back exits the app instead of returning to list on phone | navigation feels broken | use route-based second-level detail only on `phone` posture |
| Validation covers only phone and wide | compact shell regressions survive | add compact-open and compact-closed screenshots |
| Same boolean means two different things in compact vs wide | implementation drifts back into breakpoint folklore | rename `sidebarOpen` to `railVisible` or equivalent semantic state |

### Failure Modes Registry

| Failure mode | Why it matters | Prevention |
|---|---|---|
| Hidden rail + mobile toolbar on wide viewport | wastes space and feels unfinished | toolbar mode computed from shell posture and rail exposure rules |
| Compact rail behaves like a drawer instead of a split pane | compact posture feels like phone instead of narrow desktop | keep compact rail inline in the main grid |
| Session detail becomes unreadable when inspector is open in compact widths | main job regresses | compact posture auto-closes or demotes inspector |
| Rail toggle semantics differ between home and session routes | app feels like different products | shell-level control only, no route-local toggle state |
| Two separate rail render paths survive (`WorkspaceLayout` and `HomeRoute`) | shell state is duplicated again | move rail containment decision fully into shell posture contract |

### NOT in scope

- redesigning session transcript hierarchy
- changing artifact IA
- new backend endpoints
- replacing the current rail item model
- adding user-configurable custom breakpoints

### Dream state delta

This plan gets us to one semantic shell posture system. It does not yet add persisted layout preferences, container queries, or multi-panel desktop layout memory. Those are good follow-ups, not prerequisites.

### CEO completion summary

Pass, with one required constraint: the redesign must land with semantic posture primitives and validation evidence. A breakpoint-only diff is not sufficient.

## Phase 2, Design Review

### Design litmus summary

| Dimension | Score / 10 | Notes |
|---|---:|---|
| Information hierarchy | 9 | phone gets true second-level detail, not a squeezed shell |
| Navigation clarity | 9 | top-left action becomes deterministic by posture |
| State coverage | 8 | compact-open / compact-closed explicitly modeled |
| Responsive intent | 10 | shell posture becomes a first-class design decision |
| Action reachability | 9 | toolbar and rail actions stay reachable without mode confusion |
| Accessibility | 7 | needs explicit focus and keyboard rules in implementation |
| Visual continuity | 8 | same shell semantics across sizes, with intentional posture changes |
| Naming clarity | 8 | posture and rail terms must replace overlay-specific naming |

### Design findings

1. The toolbar must not infer its own mode from raw viewport width. That makes the compact-open state unreadable.
2. The left rail should behave as navigation chrome, not as part of the content page. That means the rail mode belongs to the shell.
3. In compact posture, opening the rail effectively reduces detail-pane usable width. That is a design-mode change, not an overlay animation.
4. Phone detail should behave like a real second-level screen. That means a deterministic in-app back action to the thread list, not browser-history semantics.

### Design-specific decisions

- `phone` posture keeps the current two-level navigation model, but the breakpoint moves from route-local `md` assumptions to shell posture `< sm`.
- `compact shell` uses a rail toggle button in the toolbar left slot.
- In `compact shell`, `rail open => mobile toolbar`, `rail closed => desktop toolbar`.
- `wide shell` always uses desktop toolbar presentation, even when the rail is hidden.
- Route-local rail rendering is removed. The shell owns rail presence everywhere.
- In `compact shell`, the visible rail is inline like desktop, not a drawer.
- The implementation cutoff should be `<640`, `640-1023`, `>=1024`. Do not literally key compact/wide off default `md`.

### Missing states to cover

- compact shell with rail open and an active session
- compact shell with no selected session
- phone detail route back navigation
- wide shell with rail hidden and visible
- direct deep-link into `/sessions/:id` on phone with no prior history

### Design completion summary

The requested behavior is coherent. The critical insight is that toolbar mode must key off shell exposure, not only viewport width.

## Phase 3, Engineering Review

### Architecture verdict

This is a frontend shell refactor, not a route redesign and not a backend feature.

### Proposed architecture

```text
WorkspaceLayout
  -> useWorkspacePosture()
      -> viewport class: phone | compact | wide
      -> rail visibility: visible | hidden
      -> detail mode: standalone | shell
      -> toolbar mode: mobile | desktop
      -> leading action: back | toggle-rail
  -> WorkspaceShellContext
      -> posture
      -> railVisible
      -> showRail / hideRail / toggleRail
  -> HomeRoute / SessionRoute
      -> render based on shell posture contract
  -> WorkspaceTopbar
      -> receives toolbarMode + leadingAction variant
  -> SessionWorkspacePane
      -> keeps content hierarchy, stops owning responsive decisions
```

### Blast radius

| File | Change |
|---|---|
| `ui/src/components/app/workspace-layout.tsx` | centralize posture detection and inline rail visibility behavior |
| `ui/src/components/app/workspace-shell-context.tsx` | add posture and toggle APIs |
| `ui/src/routes/home-route.tsx` | stop hardcoding `md` route split |
| `ui/src/routes/session-route.tsx` | use second-level page only in `phone` posture |
| `ui/src/components/app/workspace-topbar.tsx` | consume explicit toolbar mode and leading action |
| `ui/src/components/app/session-detail-pane.tsx` | remove implicit toolbar assumptions, compact inspector rules |
| `ui/src/components/app/session-inspector-pane.tsx` | compact posture behavior |
| `scripts/validate-transcript-ui.ts` or equivalent validation surface | add posture-specific checks |

### Engineering decisions

1. Add a dedicated posture helper, not scattered `window.matchMedia` calls inside multiple components.
2. Do not introduce a generic responsive store library. Local shell context is enough.
3. Use semantic enums or string unions, not booleans like `isMobile`.
4. Keep the existing routes. The difference is whether the shell renders rail + pane together, not whether the route list changes.
5. Rename `sidebarOpen` to a semantic name such as `railVisible`. The old name is overlay-specific and will mislead wide-shell implementation.
6. Back navigation on phone detail should be `navigate(-1)` with `/` fallback, not unconditional `navigate("/")`.
7. Put the posture thresholds in one helper as numeric constants or named config: `PHONE_MAX = 639`, `COMPACT_MAX = 1023`. Do not derive wide mode from current `md`.

### Test diagram

| Flow / codepath | Coverage needed | Why |
|---|---|---|
| `/` in `phone` posture shows only rail | browser validation + screenshot | confirms entry-page behavior |
| `/sessions/:id` in `phone` posture shows detail with back button | browser validation + screenshot | confirms second-level page behavior |
| `/sessions/:id` opened directly in a fresh tab on phone | browser validation + interaction | confirms back fallback lands on `/` |
| `compact shell`, rail closed, active session | browser validation + screenshot | confirms desktop toolbar mode in compact width |
| `compact shell`, rail open, active session | browser validation + screenshot | confirms mobile toolbar mode while rail consumes width inline |
| `wide shell`, rail visible | browser validation + screenshot | confirms desktop shell baseline |
| `wide shell`, rail hidden | browser validation + screenshot | confirms `> sm` toggle semantics |
| compact rail expand / collapse through the toolbar toggle | interaction test | confirms compact works like narrow desktop, not drawer |

### Performance and complexity

This refactor is low runtime risk. The complexity risk is state duplication. The fix is to derive `toolbarMode` from posture and rail visibility in one place.

### Security

No new trust boundary.

### Deployment risk

Medium. Responsive shell changes are easy to ship half-right if validation only covers one or two widths.

### Failure modes registry

| Gap | Severity | Fix |
|---|---|---|
| `toolbarMode` computed independently in topbar | high | compute once in shell, pass down |
| route files still branch on raw `md` classes | high | branch via posture contract |
| inspector remains `lg`-gated while shell moves to `md` semantics | high | update inspector visibility rules together |
| validation script lacks compact posture checks | high | add compact-open and compact-closed assertions |
| `sidebarOpen` naming survives the refactor | medium | rename to semantic rail visibility language before landing |
| compact rail still implemented as overlay | high | keep compact and wide on the same inline split-pane mechanic |

### NOT in scope

- refactoring session data hooks
- changing Connect / SSE contracts
- inspector content redesign

### Engineering completion summary

The architecture is sound if posture detection and derived UI modes live in shell state. It is unsound if any component keeps private breakpoint logic.

## Phase 3.5, DX Review

### Product type

Developer tool, browser-first control plane for local coding agents.

### Developer journey map

| Stage | What the developer does | Desired experience |
|---|---|---|
| 1 | Opens hopter on phone | sees thread list immediately |
| 2 | Opens a running thread | detail page reads as a second-level screen |
| 3 | Wants to go back | back button is obvious and reliable, and deep links still fall back to the thread list |
| 4 | Opens hopter on compact tablet or narrow desktop | shell remains one app, not a phone clone |
| 5 | Needs thread list temporarily | rail toggle is obvious |
| 6 | Opens rail in compact mode | toolbar adapts while the inline rail narrows the detail pane |
| 7 | Closes rail again | toolbar expands back into desktop mode |
| 8 | Uses wide desktop | rail visibility remains controllable |
| 9 | Runs validation before ship | evidence exists for all shell postures |

### Developer empathy narrative

"I do not want to remember which width secretly flips which part of the app. I want one shell model I can reason about, and I want validation that proves the weird middle widths are covered."

### DX Scorecard

| Dimension | Score / 10 | Notes |
|---|---:|---|
| Discoverability | 8 | posture model is straightforward once centralized |
| Naming | 9 | `phone`, `compact`, `wide`, `toolbarMode` are explicit |
| Local reasoning | 9 | fewer hidden breakpoint couplings |
| Testability | 9 | posture matrix is easy to automate |
| Upgrade safety | 8 | contained blast radius if context API is the only seam |
| Docs alignment | 9 | matches existing product docs better than current code |
| Edge-case clarity | 8 | compact-open rule is explicit |
| Future extension | 8 | leaves room for persisted rail preferences later |

### TTHW assessment

- Current TTHW to understand responsive behavior: high, because multiple files use different breakpoints.
- Target TTHW after redesign: under 5 minutes, because one posture helper explains the whole shell.

### DX implementation checklist

- define posture helper and exported type
- update shell context
- migrate layout, routes, topbar, inspector
- remove route-local `md` / `lg` shell decisions
- remove duplicated rail render ownership from `HomeRoute`
- rename overlay-specific state names
- add posture matrix validation
- record evidence paths in validation notes

### DX completion summary

This redesign improves developer experience because it replaces implicit breakpoint folklore with explicit posture semantics.

## Cross-Phase Themes

1. One source of truth for shell posture.
2. Toolbar mode must be derived, not guessed.
3. Compact widths are the real regression zone and need dedicated proof.

## Implementation Plan

### Slice 1, posture primitive

- add `useWorkspacePosture` or equivalent shell helper
- return `posture: "phone" | "compact" | "wide"`
- return `toolbarMode: "mobile" | "desktop"`
- return `detailMode: "standalone" | "shell"`
- set thresholds to `<640`, `640-1023`, `>=1024`

### Slice 2, shell and routes

- migrate `WorkspaceLayout` to use semantic posture
- update `HomeRoute` and `SessionRoute`
- keep `< sm` as second-level page behavior only
- eliminate route-local duplicate rail rendering

### Slice 3, toolbar and inspector

- make `WorkspaceTopbar` render from explicit mode
- make leading action variant one of `back` or `toggle-rail`
- align inspector behavior with compact widths
- wire phone back action as history-first with `/` fallback

### Slice 4, validation

- add screenshots and assertions for:
  - phone list
  - phone detail
  - compact closed
  - compact open
  - wide visible rail
  - wide hidden rail

## Validation Plan

Evidence must include:

1. screenshot, phone thread list
2. screenshot, phone thread detail with back button
3. screenshot, compact shell with rail closed and desktop toolbar
4. screenshot, compact shell with rail open and mobile toolbar
5. screenshot, wide shell with rail visible
6. screenshot, wide shell with rail hidden
7. interaction evidence for compact inline rail toggle and phone back navigation
8. interaction evidence for direct phone deep-link back fallback

## Review Scores

- CEO: pass, scope is right
- Design: 8.6 / 10
- Eng: pass, architecture is clean if centralized
- DX: 8.5 / 10

## Dual Voices

Outside-voice review was not executed in this run. This document is therefore a single-reviewer autoplan output, not a dual-voice autoplan output.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 1 | CEO | redesign shell posture, not isolated breakpoints | mechanical | explicit over clever | root problem is split shell truth | patch topbar only |
| 2 | CEO | keep backend / IDL unchanged | mechanical | pragmatic | issue is entirely UI shell state | API redesign |
| 3 | Design | `< sm` uses standalone detail page | user-directed | completeness | matches phone job and user request exactly | keep split-pane phone shell |
| 4 | Design | `sm-md` compact-open uses mobile toolbar | user-directed | completeness | available width is effectively phone-like when rail is exposed | keep desktop toolbar always |
| 5 | Design | `sm-md` compact-closed uses desktop toolbar | user-directed | bias toward action | content gets the space back, so higher-density chrome is valid | force mobile toolbar always |
| 6 | Eng | use semantic posture union types | mechanical | explicit over clever | easier to reason about than scattered booleans | multiple `isMobile` flags |
| 7 | Eng | rename `sidebarOpen` to semantic rail visibility language | mechanical | explicit over clever | state name should survive all postures cleanly | keep overlay-specific naming |
| 8 | Eng | shell context owns rail visibility for all `> sm` widths | taste | completeness | matches requested toggle behavior and reduces duplicated state | overlay-only rail state |
| 9 | Eng | add compact posture validation as mandatory evidence | mechanical | choose completeness | current regressions live in the middle widths | phone + wide only screenshots |
| 10 | DX | keep same routes, vary shell behavior | taste | pragmatic | preserves URL model while fixing UX | invent new route tree |
