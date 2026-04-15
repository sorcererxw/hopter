# UI System Rules

`orchd` uses a shadcn-style UI system on top of the `ui/` React + Vite app.

The goal is one primitive layer, one token system, and one workspace-first product hierarchy.

## Directory boundaries

```text
ui/src/components/ui/     # primitive building blocks
ui/src/components/app/    # product-specific workspace surfaces
ui/src/routes/            # route surfaces
ui/src/index.css          # shared theme/tokens
```

## Hard rules

1. New primitive components must enter through the official shadcn CLI flow.
2. Do not hand-roll a second primitive library.
3. `ui/src/components/ui/*` is for primitives only.
4. Product meaning belongs in app/feature components, not primitive files.
5. The main product surface remains the workspace shell:
   - left session rail
   - right workspace pane

## Allowed customization

- Editing generated primitive files is fine after they land.
- Wrapping primitives with app-specific components is fine.
- Bypassing the CLI for a new primitive is not fine.

## Product hierarchy rules

For the selected session pane, keep this order visible:

1. status/header
2. summary
3. attention
4. input/composer
5. artifacts
6. timeline/history

## Workflow

1. Add primitives via the official shadcn CLI inside `ui/`.
2. Put workspace-specific composition in `ui/src/components/app`.
3. Keep the Go-origin route model intact:
   - `/`
   - `/sessions/:sessionId`
   - `/projects/new`
   - `/settings`
