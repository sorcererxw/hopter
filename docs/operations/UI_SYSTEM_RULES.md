# UI System Rules

`orchd` now uses a shadcn-style UI system on top of a Bun-first build and React Router frontend.

The point is not to make the app look like a generic admin dashboard. The point is to keep one primitive system, one token system, and one product hierarchy while the control plane keeps evolving.

## Directory boundaries

```text
src/web/app/components/ui/        # primitive building blocks
src/web/app/components/orchd/     # product-specific wrappers and control-plane surfaces
src/web/app/routes/               # React Router route surfaces
src/web/app/styles/               # theme tokens and shared web styles
```

## Hard rules

1. New primitive components must enter the repo through the shadcn CLI flow:

   ```bash
   bun run ui:add -- <component>
   ```

2. Do not hand-roll a second primitive library. No custom one-off `Button`, `Card`, `Input`, `Badge`, `Dialog`, `Tabs`, `Sheet`, `Tooltip`, or `ScrollArea` clones outside `components/ui`.
3. `src/web/app/components/ui/*` is for primitives only. No product copy, no workflow semantics, no route-specific state.
4. `src/web/app/components/orchd/*` is where product meaning lives. Session attention, artifact viewers, host status, action bars, and route-specific composition belong there.
5. Routes compose primitives and orchd components. They do not invent a third abstraction layer.

## Allowed customization

- It is fine to edit generated primitive files after they land, but the starting point must come from the CLI flow.
- It is fine to wrap primitives with orchd-specific variants in `components/orchd`.
- It is not fine to bypass the CLI and add a hand-made primitive because it felt faster in the moment.

## Product hierarchy rules

On the backend session detail surface, keep this order visible and obvious:

1. status
2. summary
3. attention
4. artifacts
5. timeline
6. terminal

That order is the product. Terminal is secondary. Attention is first-class. Artifacts are not hidden in a log stream.

## Workflow

1. Need a new primitive, run `bun run ui:add -- <component>`.
2. If the product needs extra semantics, wrap it in `components/orchd`.
3. Update screenshots or validation when the change affects a primary surface.
4. Keep the Bun-first build and static `web-dist` contract intact unless a spec change explicitly says otherwise.
