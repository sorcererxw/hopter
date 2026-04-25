# Add Repo Finder-Style Picker Plan

Date: 2026-04-15
Branch: master
Request: `Add repo` 要像 macOS Finder 的文件选择器, 用多列树状排布, 但目录数据必须由 server 端读取。

## Plan Summary

这次不再做“系统原生 picker”。

改成 **Finder column view 风格的自建 Dialog**:
- 左到右多列层级导航
- 点击一列中的文件夹, 右侧生成下一列
- 顶部保留 breadcrumb / path bar
- 右侧保留 preview / metadata 面板
- 底部固定主动作
- 所有目录和 repo 信息都由 server 端 API 返回

这才同时满足两件事:
1. 视觉和交互上像 macOS Finder 的列视图文件选择器
2. repo path 仍然是 host machine truth, 不是 browser truth

## External references

### Apple / Finder references used

- Apple file management HIG: https://developer.apple.com/design/human-interface-guidelines/file-management
- Legacy Apple HIG on column view usefulness for deep hierarchies: https://leopard-adc.pepas.com/documentation/UserExperience/Conceptual/AppleHIGuidelines/XHIGControls/XHIGControls.html
- Finder preview pane support article: https://support.apple.com/sq-al/guide/mac-help/mchl1e4644c2
- Finder column/list/gallery overview reference: https://www.imore.com/customizing-finder-window-content

### What matters from those references

The important Finder qualities are:
- **column view is good for deep hierarchy navigation**
- users can move left/right through folders without losing context
- selected item gets a preview / metadata region
- the layout stays spatial, not list-jumpy
- path context stays visible while browsing

That is the interaction quality we should copy.

## Local product constraint

Repo paths must still be read from the gateway host.

So the browser must never enumerate local client folders.
Every directory column, preview, and repo badge must come from server APIs.

## Approaches considered

### Approach A, fake Finder with single list only

One list, breadcrumb on top, preview on right.

Pros:
- smaller scope
- easy to implement

Cons:
- does not feel like Finder column navigation
- each navigation step replaces the list, so users lose spatial memory
- misses the actual thing the user asked for

Verdict: reject.

### Approach B, true multi-column Finder-style dialog backed by server APIs

Dialog body has 3 zones:
- left/middle: multiple live directory columns
- right: preview / metadata panel
- bottom: selected path + actions

Pros:
- feels much closer to Finder column view
- still keeps server as source of truth
- works the same in local and remote usage
- no fake browser filesystem access

Cons:
- more UI state
- more API round-trips unless cached well

Verdict: recommended.

### Approach C, full remote file manager

Search, sort, tags, multi-select, drag/drop, full preview suite.

Pros:
- very powerful

Cons:
- ocean, not lake
- turns add-repo into a separate product

Verdict: reject.

## Recommended direction

Choose **Approach B**.

One sentence version:
**build a Finder column-view style repo picker inside a HeroUI modal, with every column populated by server-side directory reads.**

## UX redesign

## Dialog structure

### Header

- Title: `Add repo`
- Subtitle: `Browse the host machine like Finder. The server reads every directory you see.`

### Toolbar row

- breadcrumb / path chips
- current path text field
- refresh button
- optional search field scoped to current folder / subtree later

### Main browser body

#### Left-to-right column stack

Column 1:
- roots / top-level allowed locations

Column 2:
- children of selected root

Column 3:
- children of selected folder

Column 4+:
- continue as needed horizontally

Rules:
- selecting a directory highlights the row and opens the next column
- selecting a repo marks it as the current candidate
- earlier columns remain visible, just like Finder column view
- horizontal scrolling is allowed on narrow screens

#### Right preview pane

When a directory / repo is selected, show:
- folder name
- canonical host path
- whether `.git` exists
- whether the path is allowed
- child counts if cheap to compute
- warning copy if path is not a valid repo yet

This should feel like Finder's preview pane, but optimized for repo selection rather than file previews.

### Footer

- Context name input
- selected repo path summary
- Cancel
- Connect repo

## Interaction model

### Single click on a directory

- selects it
- opens next column
- updates preview pane

### Single click on a repo directory

- selects it as current candidate
- keeps next column optional
- enables primary action if valid

### Go up

Not a primary button per row.
Users go up by clicking an earlier column selection or breadcrumb, like Finder.

### Mobile behavior

Still the same model, just horizontally scrollable columns.
Do not collapse to a completely different tree pattern unless we have to.

## Information architecture in the dialog

1. where you are
2. what folders are available at this level
3. what the selected folder is
4. whether it is a repo
5. connect action

That order keeps it Finder-like and still product-clear.

## Server API design

We already added a first pass of server-side directory reading. For Finder-style columns, tighten it.

### `GET /api/host/fs/roots`
Return top-level roots the user is allowed to browse.

### `GET /api/host/fs/list?path=...`
Return one directory listing for one column.

Response should include at least:
- `currentPath`
- `parentPath`
- `entries[]`
  - `name`
  - `path`
  - `isDirectory`
  - `isRepo`
  - `hasChildren`
  - `isAllowed`

### `GET /api/host/fs/metadata?path=...`
New endpoint.
For the preview pane.

Response should include:
- canonical path
- basename
- `isRepo`
- `isDirectory`
- `isAllowed`
- maybe child counts / modified time if cheap

### `GET /api/host/fs/recent-repos`
Keep this.
Use it as quick access above or below the columns.

## Component plan

### New UI component
- `src/web/app/components/hopter/add-repo-dialog.tsx`

Sub-pieces inside it:
- `FinderColumnBrowser`
- `FinderColumn`
- `FinderPreviewPane`
- `RepoSelectionFooter`

### Supporting primitives
Already present or needed:
- `dialog`
- `scroll-area`
- `input`
- `button`
- `separator`
- `badge`

## State model

Client state should track:
- `open`
- `columnPaths[]`
- `selectedDirectoryPath`
- `selectedRepoPath`
- `previewPath`
- `contextName`
- `manualPath`
- `error`

Important rule:
- column navigation state is UI state
- filesystem truth is server state

## Failure modes registry

| Failure mode | Why it matters | Mitigation |
|---|---|---|
| Dialog feels like a generic list, not Finder | misses user intent | keep persistent multi-column spatial navigation |
| Browser reads client filesystem | wrong machine | forbid browser filesystem APIs entirely |
| Column navigation refetches too aggressively | laggy UX | cache per-path directory listings client-side |
| Horizontal columns break on mobile | unusable picker | horizontal scroll with fixed-width columns and sticky footer |
| Preview pane lies about repo validity | user selects bad folder | preview data comes from server metadata endpoint |
| Allowlist rejection appears only on submit | frustrating | show allowed/disallowed state in preview pane before submit |

## Error and rescue registry

| Risk | Early signal | Rescue move |
|---|---|---|
| We accidentally build breadcrumb-only navigation | only one list visible at a time | restore persistent columns before shipping |
| Column count explodes on deep paths | dialog becomes too wide | constrain column width and allow horizontal scroll |
| Preview pane becomes empty decoration | no useful repo metadata | require canonical path + repo validity + allowlist state |
| Performance gets janky | repeated directory reads on same path | memoize path listings in dialog state |

## NOT in scope

- full remote file manager
- drag/drop file operations
- arbitrary file preview types
- browser filesystem APIs
- OS-native picker integration

## Validation plan

Required:
1. `bunx tsc --noEmit`
2. `bun test`
3. `bun run build:web`
4. `bun run validate:web-shell`
5. screenshots for:
   - dialog initial open
   - dialog with 3+ directory columns visible
   - dialog with repo selected and preview pane populated
   - validation error state

## Final recommendation

Rebuild the add-repo flow to look like Finder's column-view chooser, not like a flat form.

But keep the data model brutally honest:
**server reads directories, client renders columns.**

That's the whole game.
