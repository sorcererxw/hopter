# UI System Rules

`hopter` uses a HeroUI-backed UI system on top of the `ui/` React + Vite app.

The goal is one primitive layer, one token system, and one workspace-first product hierarchy.

## Directory boundaries

```text
ui/src/components/app/shared/heroui-adapter.tsx  # temporary HeroUI compatibility adapter
ui/src/components/app/                           # product-specific workspace surfaces
ui/src/routes/                                   # route surfaces
ui/src/index.css                                 # shared theme/tokens
```

## Hard rules

1. App and route code should use HeroUI v3 components directly or through the temporary `heroui-adapter.tsx` compatibility layer.
2. Do not restore `ui/src/components/ui/*`, `components.json`, or a shadcn registry workflow.
3. Do not hand-roll a second primitive library.
4. Product meaning belongs in app/feature components, not primitive wrappers.
5. The main product surface remains the workspace shell:
   - left session rail
   - right workspace pane

## Allowed customization

- Keeping compatibility wrappers around migrated HeroUI components is fine while callsites are simplified.
- Wrapping primitives with app-specific components is fine.
- Importing shadcn-generated primitives is not fine.

## Product hierarchy rules

For the selected session pane, keep this order visible:

1. status/header
2. summary
3. attention
4. input/composer
5. artifacts
6. timeline/history

## Workflow

1. Add HeroUI dependencies and styles through `ui/package.json` and `ui/src/index.css`.
2. Put workspace-specific composition in `ui/src/components/app`.
3. Keep the Go-origin route model intact:
   - `/`
   - `/sessions/:sessionId`
   - `/projects/new`
   - `/settings`
4. During adapter cleanup, prefer direct HeroUI compound APIs where they keep the callsite readable.
