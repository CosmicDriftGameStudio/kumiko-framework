---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

UI new-york alignment (framework batch):

- `<Section>` / `<Form>` carry `subtitle` + an elevated `actions` footer-row; the
  hard header-divider is gone (title flows into the body, shadcn pattern).
- `DefaultAppShell` gains a `headerActions` slot (right of the breadcrumb) for the
  theme toggle / global actions.
- `NavTree` + `DefaultAppShell` gain `navBadges` — a per-leaf runtime badge slot
  keyed by bare nav-id; the app supplies value + color (e.g. a tier badge) without
  baking it into the static nav schema.
- Bundled `ProfileScreen` adopts the one-card-per-section standard (no more card-in-
  card) with a two-column layout for the short account forms; bundled `TagSection`
  moves its create-tag input + button onto one inline row.
