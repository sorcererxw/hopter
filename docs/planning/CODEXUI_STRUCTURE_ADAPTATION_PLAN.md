# CodexUI Structure Adaptation Plan

Date: 2026-04-15
Branch: master
Request: 参考 `friuns2/codexUI` 的 UI/UX 结构，复刻其整体信息架构和交互节奏，但继续使用 `orchd` 现有的 shadcn token / primitive 体系，不改产品本质。

## Plan Summary

把 `codexUI` 借来的东西限定在 **壳层、导航、密度、移动端节奏、底部输入器、左侧树状结构**。

不借它的东西也要说清楚: `orchd` 不能退化成一个通用 chat wrapper。我们的 session detail 仍然必须保持 `status → summary → attention → artifacts → timeline → terminal` 这条产品主线。

所以这不是“照着抄界面”。这是 **用 codexUI 的结构骨架，承载 orchd 自己的控制平面语义**。

## User override

用户最终选择了 **B**: 不只复制 shell，也尽量向 `codexUI` 的产品语义靠拢。

这会直接改变原先的建议方向。

新的执行原则变成:
- sidebar 不只是 binding/session 导航，也承担更强的 thread-style 工作入口
- main pane 允许更明显地围绕对话/turn 流展开
- composer 从“控制动作栏”提升为主交互入口
- 但仍保留 orchd 现有必须成立的 truth surfaces: degraded honesty、approval identity、artifact inspection

这不是原始推荐方案。它是用户明确选择的 override。

## Locked decisions

用户已明确拍板:

1. **去掉 binding 概念**
   - UI 和主导航不再把 binding 作为一级产品概念
   - session 成为唯一核心容器
   - repo / project context 退到 session 创建流或 metadata

2. **主区就是正常对话**
   - session detail 的中心区域按标准对话流组织
   - summary / attention / artifacts 作为对话工作面的结构块嵌入其中

3. **不要 Skills Hub 占位入口**
   - sidebar 不预留 skills / marketplace 入口
   - 保持最小产品面

## Sources inspected

### External reference

- Repository: <https://github.com/friuns2/codexUI>
- Router: <https://raw.githubusercontent.com/friuns2/codexUI/main/src/router/index.ts>
- Root shell: <https://raw.githubusercontent.com/friuns2/codexUI/main/src/App.vue>
- Desktop/mobile layout: <https://raw.githubusercontent.com/friuns2/codexUI/main/src/components/layout/DesktopLayout.vue>
- Pending request panel: <https://raw.githubusercontent.com/friuns2/codexUI/main/src/components/content/ThreadPendingRequestPanel.vue>
- Skills hub: <https://raw.githubusercontent.com/friuns2/codexUI/main/src/components/content/SkillsHub.vue>
- Theme baseline: <https://raw.githubusercontent.com/friuns2/codexUI/main/src/style.css>
- Desktop screenshot: <https://github.com/friuns2/codexUI/raw/main/docs/screenshots/chat.png>
- Mobile screenshot: <https://github.com/friuns2/codexUI/raw/main/docs/screenshots/chat-mobile.png>
- Skills mobile screenshot: <https://github.com/friuns2/codexUI/raw/main/docs/screenshots/skills-hub-mobile.png>

### Local code and docs

- `docs/product/PRODUCT_MEMO.md`
- `docs/product/DESIGN_DOC.md`
- `docs/specs/COMMUNICATION_AND_UX_SPEC.md`
- `docs/specs/ENGINEERING_SPEC_V1.md`
- `docs/operations/UI_SYSTEM_RULES.md`
- `docs/planning/SHADCN_TOKEN_CONVERGENCE_PLAN.md`
- `src/web/app/shell/app-shell.tsx`
- `src/web/app/routes/dashboard.tsx`
- `src/web/app/routes/binding-detail.tsx`
- `src/web/app/routes/backend-session-detail.tsx`
- `src/web/app/components/orchd/page-hero.tsx`
- `src/web/app/components/orchd/session-list.tsx`
- `src/web/app/components/orchd/start-session-form.tsx`

## What codexUI is actually doing well

This is the useful part.

1. **A real shell**
   - fixed app chrome
   - collapsible and resizable sidebar
   - mobile drawer behavior
   - content area that always feels like one app, not disconnected pages

2. **One dominant working loop**
   - select context in the sidebar
   - read content in the main pane
   - act from a bottom composer

3. **High-density navigation**
   - tree/list structure in the sidebar
   - recent items grouped and scannable
   - search/filter affordance near the list itself

4. **Mobile discipline**
   - top bar stays minimal
   - drawer replaces desktop sidebar cleanly
   - composer remains reachable

5. **Empty state pacing**
   - when nothing is selected, the main pane does not become a junk dashboard
   - it shows one obvious “start work” state

That is the real value to copy.

## What we must not copy

1. **Chat-first product framing**
   `orchd` is a remote control plane. Not a chat wrapper.

2. **Threads as the only truth model**
   Our product model is still `binding -> backend session`, with a cross-binding attention layer.

3. **Skills-hub / marketplace semantics**
   That is codexUI’s product. Not ours.

4. **Terminal-adjacent “one pane to do everything” behavior**
   The user should still land in status/summary/attention first.

5. **Ad hoc Tailwind visual language**
   We stay on shadcn primitives, semantic tokens, and orchd wrappers.

6. **codexUI-specific feature payload**
   Do not copy voice dictation, image/file attachment workflow, GitHub skills sync, account switcher, or transcript-heavy command chrome unless there is a separate product requirement.

## User challenge

The request says “复刻这个项目的 uiux 结构”. If interpreted literally, that would push orchd toward a thread-first chat product.

I recommend a narrower reading:

**Copy the shell and interaction structure, not the product semantics.**

Why this matters:
- literal cloning would violate our own product docs
- it would hide approval, artifacts, and degraded state behind chat flow
- it would make the app feel more like “Codex in browser” and less like “remote control plane for your own machine”

If we are wrong, the cost is that the result may feel less like a faithful clone. If we ignore this, the cost is worse: we lose the product wedge.

## Existing code leverage map

| Sub-problem | Existing local asset | Reuse strategy |
|---|---|---|
| App shell | `src/web/app/shell/app-shell.tsx` | refactor into split-pane codexUI-like shell, do not replace routing model |
| Status-first cards | `components/orchd/*`, `page-hero.tsx`, `status-badge.tsx` | keep semantics, recompose inside new shell |
| Bottom action composer | `session-action-bar.tsx`, `start-session-form.tsx` | convert to anchored composer variants |
| Attention handling | `attention-panel.tsx` | elevate into content-stack block, not hidden modal |
| Artifacts | `artifact-list.tsx`, `artifact-viewer.tsx` | fit into codexUI-like main pane tabs/panels |
| Mobile drawer | current responsive layout + shadcn primitives | replace left-column page layout with drawer-capable app shell |
| Token system | `components.json`, `styles/index.css`, token convergence docs | stay on shadcn semantics, no second primitive system |

## Current diagnosis

The current UI is good enough to prove the product. It is not yet a tight app shell.

What feels weak today:

1. **Every route feels like its own card page**
   `dashboard.tsx`, `binding-detail.tsx`, and `backend-session-detail.tsx` all read like standalone panels inside a generic admin layout.

2. **Sidebar is too static**
   It is a marketing/sidebar hybrid right now. Good copy. Weak operational density.

3. **Action entry is too local to each page**
   Starting a session and steering a running session do not feel like the same product gesture.

4. **Dashboard is still card-grid-first**
   codexUI’s shell feels like an app you live in. Our dashboard still feels like a route you visit.

5. **Session detail hierarchy is right, but layout rhythm is too vertical**
   Everything stacks. Little sense of shell, context, and persistent action surface.

## Three approaches

### Approach A, literal clone

Implement a near-1:1 codexUI shell: thread-like left tree, centered empty state, bottom chat composer, minimal route distinction.

Pros:
- closest visual match
- fastest path to “looks like the reference”

Cons:
- violates orchd product semantics
- demotes status/summary/artifacts into chat-adjacent content
- makes bindings and sessions feel like generic threads

Verdict: reject.

### Approach B, structural adaptation on top of orchd semantics

Copy the **shell grammar**:
- collapsible/resizable left nav
- mobile drawer
- dense hierarchical sidebar
- top content header
- anchored bottom composer
- centered empty states

But keep orchd semantics:
- bindings and sessions, not generic threads
- session detail remains status-first
- attention stays explicit and blocking when needed
- artifacts remain first-class

Pros:
- gives the user what they actually asked for
- preserves product truth
- fits our shadcn convergence work

Cons:
- more product judgment required
- not a literal clone, so some decisions need taste

Verdict: recommended.

### Approach C, cosmetic-only refresh

Just restyle the current card routes to look a bit closer to codexUI.

Pros:
- low risk

Cons:
- misses the structural value entirely
- user asked for structure, not paint

Verdict: reject.

## Recommended direction

用户 override 后，执行方向改为 **Approach A+**。

One sentence version: **尽量复刻 codexUI 的 shell 和产品语义，但把 orchd 不能丢的 control-plane truth 强行钉住。**

## Structural mapping

| codexUI pattern | orchd equivalent after override |
|---|---|
| Sidebar thread tree | primary session tree, repo/context info only appears as session metadata or creation-time selector |
| New thread action | New session is the primary creation action; binding creation disappears from primary IA |
| Skills Hub route | optional future route placeholder, but do not clone marketplace/sync payload in this slice |
| Content header | route header stays compact and codexUI-like |
| Centered “Let’s build” empty state | centered “start a session” state, with repo/context selection nested into the flow |
| Bottom thread composer | sticky primary composer, now visually closer to the main interaction model |
| Pending request panel in content stack | approval / pending request panel stays explicit, but is visually integrated into the conversation flow |
| Mobile drawer | shadcn sheet/drawer-based navigation shell |

## Target information architecture

### Global shell

Desktop:
- **Left sidebar**: app identity, global quick actions, search/filter, attention section, binding tree, settings/account footer
- **Main pane**: top header, content stack, bottom anchored composer when relevant

Mobile:
- top bar with drawer toggle + current location title + primary status chip
- drawer for bindings/sessions navigation
- bottom composer remains reachable above viewport chrome

### Sidebar structure

1. `orchd` mark
2. global quick actions
   - New session
3. search / filter
4. attention inbox
5. session tree
   - active / recent sessions
   - optional repo/context metadata line under each row
6. settings / user footer

### Shell data contract

This is the biggest engineering gap in the current codebase.

Right now `AppShell` is auth-only and route-local pages fetch their own binding/session data. A codexUI-style persistent sidebar cannot be powered by ad hoc route fetches alone.

Recommended contract:

1. add a client hook like `useShellNavigationData()` that centralizes:
   - host truth
   - bindings list
   - recent backend sessions by binding
   - attention items
2. first implementation may compose existing endpoints in the client
3. if the shell creates duplicate polling or obvious N+1 chatter, add a gateway-owned summary endpoint such as `/api/navigation` that returns only gateway-normalized state
4. this summary endpoint must not leak raw Codex protocol details

That keeps the shell realistic without pretending the current route fetch model scales into a global navigation tree for free.

### Main pane route behavior

#### Dashboard

Not a pure card wall anymore.

Main pane should become:
1. top header with host truth and quick actions
2. attention-first inbox block
3. recent active sessions block
4. optional centered empty state if nothing exists

The sidebar carries more navigation weight. The main pane carries current operational truth.

#### Binding detail

This route should likely disappear or be demoted heavily.

If kept at all, it becomes a lightweight context/settings page, not a first-class navigation destination.

#### Backend session detail

This is the most important adaptation.

The page should feel much closer to codexUI’s focused work surface, and the main pane is now explicitly a normal conversation surface:

1. compact session header
2. conversation stream
3. embedded summary / latest turn state blocks
4. embedded pending attention block
5. embedded artifact blocks or sidecar viewer
6. timeline
7. terminal drawer

Layout target:
- top header with session title, backend id, status chip, connection truth
- center content stack that feels like one live workspace, not separate unrelated cards
- bottom sticky composer for steer / interrupt / reply
- artifacts and timeline become selectable work surfaces inside the main pane, not giant full-width card dumps

## Product contradiction to resolve

This override creates a real contradiction with current local docs.

Current docs say:
- the product is not a chat wrapper
- the primary information architecture is `binding -> backend session`
- session detail must foreground status, summary, attention, artifacts

A more literal codexUI clone pushes toward:
- session/thread-first navigation
- conversation-first main pane
- composer-first interaction model
- repo/binding context becoming secondary metadata instead of primary IA

So implementation should include a doc pass in the same branch to update:
- `docs/product/PRODUCT_MEMO.md`
- `docs/product/DESIGN_DOC.md`
- `docs/specs/COMMUNICATION_AND_UX_SPEC.md`

Otherwise the code and the docs will lie about each other.

## Detailed implementation plan

## Phase 1, Shell refactor

### Goal

Replace the current static two-column layout with a codexUI-like app shell while preserving React Router and shadcn primitives.

### Files

- `src/web/app/shell/app-shell.tsx`
- new `src/web/app/components/orchd/sidebar-shell.tsx`
- new `src/web/app/components/orchd/sidebar-binding-tree.tsx`
- new `src/web/app/components/orchd/content-header.tsx`
- new `src/web/app/lib/use-shell-navigation-data.ts`
- `src/web/app/styles/index.css`
- optional follow-up: new server summary route if client fan-out becomes too noisy

### Tasks

1. Refactor `AppShell` into a real split-pane shell.
2. Add collapsible sidebar state.
3. Add resizable desktop sidebar.
4. Add mobile drawer behavior, likely via shadcn `Sheet`.
5. Replace static nav links with a data-driven sidebar model.
6. Keep settings/account footer pinned at bottom.

### shadcn primitives to add

Use CLI flow only if needed:
- `sheet`
- `dropdown-menu`
- `command` only if sidebar search needs it

Do **not** invent custom primitive clones.

## Phase 2, Sidebar IA migration

### Goal

Turn the sidebar into a codexUI-like primary thread/navigation surface with bindings grouped underneath the shell model.

### Files

- `src/web/app/routes/dashboard.tsx`
- `src/web/app/routes/binding-detail.tsx`
- `src/web/app/components/orchd/session-list.tsx`
- `src/web/app/components/orchd/status-badge.tsx`
- new tree/navigation components

### Tasks

1. Add an attention subsection in the sidebar.
2. Render bindings as top-level items.
3. Render recent backend sessions nested under each binding.
4. Support active row styling, condensed metadata, and status chips.
5. Add lightweight search/filter for bindings and sessions.

### Guardrail

The sidebar is allowed to be dense. It is not allowed to become the source of session truth. It is navigation only.

## Phase 3, Dashboard restructure

### Goal

Make the dashboard feel like the main pane of a real app shell, not a card gallery.

### Files

- `src/web/app/routes/dashboard.tsx`
- `src/web/app/components/orchd/page-hero.tsx`
- `src/web/app/components/orchd/empty-state.tsx`
- `src/web/app/components/orchd/selectable-surface.tsx`

### Tasks

1. Replace the large hero card with a tighter content header.
2. Reframe “Attention now” as the first real inbox surface.
3. Reduce decorative hierarchy between dashboard cards.
4. Use a centered empty state when there are no bindings/sessions.
5. Keep host truth visible, but no longer let it dominate the page.

### Acceptance

A user landing on `/` should immediately answer:
- does anything need me?
- what session is active?
- where do I jump back in?

## Phase 4, Binding page becomes workspace entry

### Goal

Make binding detail feel less like an admin detail page and more like a project-thread workspace entry.

### Files

- `src/web/app/routes/binding-detail.tsx`
- `src/web/app/components/orchd/start-session-form.tsx`
- `src/web/app/components/orchd/session-list.tsx`

### Tasks

1. Compress the header into the shared content-header pattern.
2. Convert start-session form into a composer-like surface.
3. Move recent sessions closer to the top of the page.
4. Reduce the feeling that “start session” is just another card.

### Acceptance

Starting a new backend session should feel like the same action family as steering an existing one.

## Phase 5, Session page becomes focused work surface

### Goal

This is the hardest and most important slice.

### Files

- `src/web/app/routes/backend-session-detail.tsx`
- `src/web/app/components/orchd/session-hero.tsx`
- `src/web/app/components/orchd/session-status-summary-row.tsx`
- `src/web/app/components/orchd/attention-panel.tsx`
- `src/web/app/components/orchd/session-action-bar.tsx`
- `src/web/app/components/orchd/artifact-list.tsx`
- `src/web/app/components/orchd/artifact-viewer.tsx`
- `src/web/app/components/orchd/timeline-panel.tsx`
- `src/web/app/components/orchd/terminal-drawer.tsx`

### Tasks

1. Replace the current stacked hero + cards feel with a tighter content header + workspace layout.
2. Keep status and summary visually first.
3. Make attention read like a live blocking request, not a generic form panel.
4. Turn artifacts into the central work surface when present.
5. Anchor the composer to the bottom of the viewport on desktop and mobile.
6. Keep timeline collapsed/secondary by default.
7. Keep terminal in a drawer or clearly subordinate region.

### Critical guardrail

Do **not** move the composer above attention.
Do **not** make the timeline the main pane.
Do **not** make terminal a peer with artifacts.

## Phase 6, Token and primitive cleanup

### Goal

Land the shell change without breaking the shadcn convergence direction.

### Files

- `src/web/app/styles/index.css`
- `src/web/app/components/ui/*`
- `docs/operations/UI_SYSTEM_RULES.md`
- `docs/planning/SHADCN_TOKEN_CONVERGENCE_PLAN.md`

### Tasks

1. Map shell states onto semantic tokens, not raw slate/zinc literals.
2. Ensure new shell surfaces use `Card`, `Badge`, `Button`, `Separator`, `Tabs`, `Sheet` consistently.
3. Remove route-local one-off shell styling introduced during migration.
4. Update UI rules doc if new primitives are added.

## CEO review

### Right problem?

Yes, with one correction.

The right problem is not “make orchd look cooler”. The right problem is “make orchd feel like one continuous remote operating surface across desktop and phone”.

`codexUI` is useful because its shell already feels continuous. That is the product gap we should close.

### Premises

1. Users want codexUI’s shell density more than its product semantics, **accepted**.
2. A shell-first refactor can happen without violating orchd’s control-plane wedge, **accepted with guardrails**.
3. The existing shadcn convergence work gives us enough primitive foundation to do this cleanly, **accepted**.
4. We should import skills-hub/chat semantics because they are visible in the reference, **rejected**.

### 6-month regret check

The regret scenario is obvious: we do a visual clone, ship a prettier app, and quietly erase the “status / approval / artifact / degraded honesty” hierarchy that makes orchd different.

Avoid that and this direction is good.

## Design review

### What should be copied exactly

- shell density
- sidebar collapse / drawer rhythm
- centered empty-state pacing
- sticky composer ergonomics
- compact top bar

### What should be adapted, not copied

- left-tree labels and grouping
- main-pane block order
- action affordances
- status colors and badges
- artifact workspace behavior

### Primary design risks

1. **Over-chatification**
   The session page could start reading like a chat transcript product.

2. **Sidebar overload**
   If we dump too much operational state into the sidebar, it becomes noisy.

3. **Composer dominance**
   A bottom composer is good. A bottom composer that visually overpowers status and attention is bad.

### Design verdict

Proceed, but copy shell rhythm, not screen semantics.

## Engineering review

### Architecture changes

This is a front-end shell refactor, not a server-contract change.

That is good. Keep it that way.

### Likely file blast radius

High-confidence files:
- `src/web/app/shell/app-shell.tsx`
- `src/web/app/routes/dashboard.tsx`
- `src/web/app/routes/binding-detail.tsx`
- `src/web/app/routes/backend-session-detail.tsx`
- most `components/orchd/*` surfaces touching navigation, headers, action bars, empty states

### Hidden complexity

1. **Route-awareness in the shell**
   The sidebar will need richer knowledge of bindings, sessions, and active route context.

2. **Composer reuse**
   “Start session” and “steer session” look similar, but they are not the same mutation path.

3. **Mobile safe-area behavior**
   Sticky bottom composer plus mobile drawer can get messy fast.

4. **Realtime honesty**
   Connection/degraded banners must survive the shell refactor without becoming visually hidden.

### Engineering verdict

Good scope. Keep it UI-only. No API churn unless a clear shell data requirement appears.

## DX review

This is a developer tool. So DX still matters.

### TTHW impact

Positive if done right.

Why:
- the app becomes easier to understand in one pass
- binding/session navigation becomes more obvious
- the primary action loop gets simpler

### DX risks

1. If the sidebar tree hides too much jargon, new users may not know whether they are selecting a binding or a backend session.
2. If the empty state becomes too cute, first-run clarity drops.
3. If the composer uses chat-style placeholder copy, it will misframe what orchd does.

### DX verdict

Use the shell to reduce cognitive load, not to cosplay a chat product.

## Failure modes registry

| Failure mode | Why it matters | Mitigation |
|---|---|---|
| Session page becomes chat-first | loses orchd wedge | enforce fixed content order in session route and validation screenshots |
| Sidebar becomes too noisy | mobile usability drops | cap nested session count, add collapse/filter rules |
| Sticky composer hides artifacts on phone | core jobs become harder | safe-area spacing, artifact area min-height, viewport tests |
| Attention loses visual priority | approval flow regresses | attention block must remain above composer and above artifacts in DOM and visuals |
| Token drift during shell rewrite | shadcn convergence regresses | only add primitives via CLI, ban route-local shell tokens |

## Error and rescue registry

| Risk | Early signal | Rescue move |
|---|---|---|
| Clone starts drifting into literal codexUI copy | copy mentions “thread” and “skills” in local route language | stop and rename IA to binding/session language before merging |
| Shell refactor explodes in one PR | too many coupled component changes | land in 3 slices: shell, sidebar IA, session workspace |
| Mobile regression | composer/drawer overlap | add dedicated mobile screenshot and interaction validation before ship |
| Status/summary lose prominence | reviewers notice composer dominates first paint | restore explicit top content stack and reduce composer contrast |

## NOT in scope

- importing codexUI features like GitHub skill sync, account switcher, marketplace, or thread archival model
- backend contract changes
- replacing React Router
- replacing shadcn primitives
- converting orchd into a transcript-first app

## Implementation sequencing

### Slice 1
- app shell
- sidebar collapse / drawer / resize
- content header

### Slice 2
- dashboard and route IA rewrite
- sidebar session tree
- empty state and quick actions

### Slice 3
- session detail workspace rewrite
- anchored composer
- artifact/timeline/terminal hierarchy cleanup

### Slice 4
- token cleanup
- product/spec doc updates to match the new session-first chat-heavier direction
- validation refresh

## Validation plan

No evidence, no pass. This refactor changes primary surfaces.

### Required automated and manual evidence

1. `bun test`
2. `bun run build:web`
3. targeted route validation update if selectors change
4. interaction checks for:
   - sidebar drawer open/close
   - sidebar resize persistence on desktop
   - keyboard focus order for drawer + composer
5. refreshed screenshots for:
   - dashboard desktop
   - dashboard mobile
   - binding detail desktop
   - binding detail mobile
   - backend session detail desktop
   - backend session detail mobile
6. explicit screenshot proving session hierarchy still reads:
   - status
   - summary
   - attention
   - artifacts
   - timeline
   - terminal

### New acceptance checks

| Req | Check |
|---|---|
| shell continuity | desktop + mobile screenshots show one consistent shell across routes |
| control-plane truth | degraded / reconnect banners remain visible above the fold |
| session hierarchy | visual order preserved on desktop and mobile |
| sticky action usability | composer reachable without hiding attention or artifacts |
| shell interaction integrity | sidebar drawer opens/closes correctly, resize persists, keyboard focus is not trapped |
| shadcn integrity | no new hand-rolled primitive layer |

## Decision audit trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 1 | CEO | copy shell grammar, not product semantics | user challenge | explicit over clever | preserves orchd wedge while honoring the reference | literal clone |
| 2 | Design | keep session detail order fixed | mechanical | completeness | product docs already define the order | chat-first reorder |
| 3 | Eng | keep refactor UI-only | mechanical | pragmatic | avoids risky API churn | backend contract rewrite |
| 4 | DX | reuse shadcn primitives for drawer/tabs/shell | mechanical | DRY | current system already converging here | custom primitive set |
| 5 | Design | use anchored bottom composer | taste | completeness | matches reference rhythm and improves phone use | local inline action bars only |
| 6 | Design | sidebar becomes primary navigation tree | taste | bias toward action | faster jump-back loop across bindings/sessions | keep current static nav |

## Final recommendation

Proceed with the override.

This now intentionally moves orchd closer to “Codex desktop app in a browser”. That is no longer treated as accidental drift, it is the chosen direction.

The one thing we still must defend is truthfulness:
- approval cannot become a generic chat bubble
- degraded state cannot disappear into the transcript
- artifacts cannot become secondary to conversation chrome

If we keep those three, the clone can go much further without breaking the product completely.
