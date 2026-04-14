# Frontend Stack Report

## Goal

Choose the right frontend stack for a heavy-interaction product:

- dashboard
- project pages
- live session timeline
- approvals and follow-up input
- diff viewing
- embedded terminal
- mobile plus desktop usage

This report separates three concerns that are often mixed together:

1. routing
2. server state
3. client state

They are not the same problem.

## Product Characteristics

This product is:

- app-like, not content-site-like
- stateful
- realtime
- event-driven
- browser-first
- not SEO-sensitive in v1
- not SSR-dependent in v1

That matters because it rules out a lot of framework weight that would otherwise be attractive.

## Decision Summary

### Recommended v1 stack

- **Frontend framework:** React
- **Build tool:** Vite
- **Router:** React Router
- **Server-state layer:** TanStack Query
- **Client-state layer:** React state first, Zustand only if needed later
- **Runtime constraint:** Bun-first across dev and server

### Explicit non-recommendations for v1

- Next.js as the main app framework
- TanStack Router as the default router
- RTK Query as the default data layer
- Jotai as the default client-state library
- using Zustand or Jotai as a substitute for server-state management

## 1. Routing: React Router vs competitors

### Candidate A: React Router

Current official positioning:

- React Router is now a "multi-strategy router"
- it supports Declarative, Data, and Framework modes
- the docs explicitly frame the choice around how much control versus how much framework help you want

Why it fits this project:

- route tree is not especially complex
- product is app-like, but not route-theory-heavy
- the hard parts are not in routing, they are in event streams, reconnect logic, terminal, artifacts, and session UX
- React Router is mature, boring, and stable
- it keeps cognitive load low while the product complexity is still elsewhere

Best use here:

- use it in SPA mode
- let the backend own `/api` and `/ws`
- let the frontend own app routes like:
  - `/`
  - `/projects/:projectId`
  - `/sessions/:sessionId`
  - `/settings/*`

Pros:

- mature
- widely understood
- lower adoption risk
- easier for contributors who have worked in mainstream React apps

Cons:

- weaker end-to-end type-safety than TanStack Router
- less ambitious search-param model

### Candidate B: TanStack Router

Current official positioning:

- strongly type-safe
- type-safe navigation
- first-class search params
- built-in loader caching
- designed to work well with TanStack Query or other client-side data caches

Why it is attractive:

- very strong TypeScript story
- search params treated as a real state layer
- good fit if route/search state is central to app design

Why it is not the best default for this project:

- the app's hardest problems are not route typing or loader design
- route count is modest
- team/product attention is better spent on gateway semantics, reconnect, and terminal behavior
- it increases architectural attention on a part of the app that is not the main risk

When it would be the better choice:

- if URL search state becomes a first-class product surface
- if route-level loaders and type-safe params become central to the architecture
- if the team values maximum router type-safety enough to absorb extra complexity

Pros:

- strongest type-safety
- strong search-param handling
- good long-term engineering elegance

Cons:

- more mental overhead
- less necessary for this route graph
- likely lower ROI for v1

### Candidate C: Next.js App Router

Why people reach for it:

- familiar full-stack React framework
- SSR/SSG/App Router story
- built-in file routing

Why it is the wrong default here:

- v1 is not SEO-first
- v1 is not content-first
- gateway backend already exists
- app complexity is in realtime control-plane behavior, not server rendering
- Next introduces server/client boundary complexity without helping the core product enough

Conclusion:

Do not use Next.js for the main gateway app in v1.

It might be useful later for marketing or docs.
It is not the right shell for the control plane.

## Routing Recommendation

For this project, the right call is:

**React Router**

Reason:

It minimizes framework complexity in a product where routing is not the bottleneck.

## 2. Server state: TanStack Query vs competitors

This is the most important distinction in the report.

**Server state is not the same thing as client state.**

Server state includes:

- project list
- project detail
- session detail
- host status
- backend status
- artifact list
- mutation results after approve / interrupt / follow-up input

These values:

- come from the backend
- can become stale
- may need retries
- may need cache invalidation
- may need refetch after mutations

### Candidate A: TanStack Query

Current official positioning:

- "powerful asynchronous state management"
- fetch, cache, update, and manage async data without turning it into global state
- explicitly framed as a solution for server state

Why it fits this project:

- session detail, host status, and artifact data are classic server-state problems
- approval and follow-up actions need mutation + invalidation
- reconnect and refetch behavior matters
- some pages will mix HTTP pull plus live WebSocket updates
- Query is a very proven fit for this class of app

Pros:

- best-in-class server-state ergonomics
- strong mutation flow
- cache invalidation
- retries and refetch behavior
- works well with a custom fetch client
- no need to adopt Redux

Cons:

- another abstraction to learn if coming from plain fetch
- can be overused if everything becomes a query, even pure local UI state

### Candidate B: SWR

Current official positioning:

- minimal API
- built-in caching, revalidation, request deduplication
- very lightweight and ergonomic

Why it is attractive:

- simple mental model
- easy adoption
- good for read-heavy apps

Why it is not the best default here:

- this app has a meaningful mutation/control surface
- session actions and cache invalidation matter a lot
- the product needs a richer async-state toolbox than the minimal path

SWR would not be a bad choice.
It is just a slightly worse fit than TanStack Query for this product.

### Candidate C: RTK Query

Current official positioning:

- powerful data fetching and caching
- built on top of Redux Toolkit
- good when Redux is already present or when API slices are a strong fit

Why it is not the right default here:

- this project does not otherwise need Redux
- adding Redux just to get query semantics adds extra surface area
- the product's state model does not benefit enough from Redux-style global orchestration

Conclusion:

Do not introduce Redux/RTK Query unless Redux is needed for other reasons.

## Server-state recommendation

For this project, the right call is:

**TanStack Query**

Reason:

This is the best fit for a server-state-heavy control-plane app with a meaningful mutation surface.

## 3. Client state: React state vs Zustand vs Jotai

This is the third and separate layer.

Client state includes:

- which artifact tab is selected
- whether the terminal drawer is open
- current draft follow-up input
- whether the mobile navigation is open
- transient UI filters and panel visibility

This is not server state.

### Candidate A: React state first

Why it fits v1:

- simplest
- lowest abstraction cost
- enough for many page-local states

Best use here:

- local component state
- form inputs
- page-level UI toggles

Conclusion:

Default to React state until there is a real pain point.

### Candidate B: Zustand

Current official positioning:

- small, fast, scalable
- minimal boilerplate
- hook-based store

Why it fits this product better than Jotai as the first optional state library:

- easy to introduce incrementally
- good for a handful of global UI concerns
- straightforward for contributors

Good use cases here:

- terminal drawer visibility
- session detail layout state
- persistent global filters
- maybe a small UI preference store

Why it should not replace TanStack Query:

- it does not solve cache invalidation, retries, stale data, or mutation lifecycles by itself

### Candidate C: Jotai

Current official positioning:

- atomic state model
- flexible and composable
- derived atoms reduce unnecessary re-renders

Why it is attractive:

- elegant for fine-grained derived state
- very nice for complex local state graphs

Why it is not the best default here:

- v1 does not yet have clear atom-shaped state complexity
- it is one more architectural idea to carry
- the product already has plenty of hard problems elsewhere

Jotai is a valid future choice if local UI state becomes more graph-like and derived.
It is not the best default today.

## Client-state recommendation

For this project, the right call is:

- **React state first**
- **Zustand only when a shared UI-state problem becomes real**
- **No Jotai by default**

## Combined Recommendation Matrix

| Concern | Recommended | Alternatives considered | Why |
|---|---|---|---|
| Runtime | Bun | Node.js | one runtime for gateway, tooling, and packaging |
| Frontend shell | React + Vite | Next.js, SvelteKit | app-first, low framework overhead |
| Routing | React Router | TanStack Router, Next App Router | simplest fit for current route complexity |
| Server state | TanStack Query | SWR, RTK Query | strongest fit for async/mutation-heavy control plane |
| Client state | React state first | Zustand, Jotai | keep v1 simple |
| Shared UI state if needed | Zustand | Jotai | easier incremental adoption |

## Practical Architecture

### Backend

- Hono
- Bun
- TypeScript
- WebSocket
- `bun:sqlite`
- filesystem artifacts
- Codex adapter
- Bun terminal/process primitives

### Frontend

- React
- Vite
- React Router
- TanStack Query
- xterm.js

### State split

- **Query:** projects, sessions, artifacts, host status, backend status
- **React state:** inputs, modal open state, per-page toggles
- **Zustand later if needed:** global UI state across multiple distant components

## Bun-first note

`Bun` should be treated as a real architecture constraint, not just a package manager choice.

That means:

- the gateway server runs on Bun
- local development commands run through Bun
- the production process is one Bun process serving API, WebSocket, and static web assets
- runtime-sensitive infrastructure should prefer Bun-native APIs over Node-only libraries

Practical implications:

- prefer Hono on Bun rather than a Node-first server stack
- prefer `bun:sqlite` rather than a Node-native SQLite dependency by default
- prefer Bun terminal/process primitives rather than assuming `node-pty` is the foundation

This does not change the frontend recommendation.
It changes the infrastructure choices underneath it.

## Why this is the best v1 choice

This stack keeps the product focused on the hard parts that actually matter:

- Codex integration
- event streams
- reconnect behavior
- remote approvals
- diff and artifact inspection
- terminal integration

It does not waste architecture budget on:

- SSR
- framework-heavy routing
- Redux-style state machinery
- over-designed client-state architecture

## Risks and Revisit Triggers

### Revisit the router choice if:

- search params become a first-class product state surface
- route-level typing pain becomes meaningful
- route loader architecture becomes central

### Revisit client-state choice if:

- cross-page UI state becomes painful
- prop drilling gets bad
- terminal/layout state becomes shared across many distant nodes

### Revisit the whole frontend architecture if:

- marketing/docs and app must unify under one rendering framework
- SSR becomes product-critical

## Final Recommendation

Use:

- **React + Vite**
- **React Router**
- **TanStack Query**
- **React state first**
- **Zustand later only if justified**

This is the cleanest and least distracting stack for a heavy-interaction control-plane product in v1.

## Source Notes

Primary official docs used in this evaluation:

- React Router docs: https://reactrouter.com/home
- TanStack Router docs: https://tanstack.com/router/latest
- TanStack Query docs: https://tanstack.com/query/latest
- SWR docs: https://swr.vercel.app/
- Redux Toolkit RTK Query docs: https://redux-toolkit.js.org/rtk-query/overview
- Zustand docs: https://zustand.docs.pmnd.rs/getting-started/introduction
- Jotai docs: https://jotai.org/
