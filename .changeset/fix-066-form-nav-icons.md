---
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

fix(renderer-web): robust one-card forms, bare auth forms, missing nav icons

The 0.66 shadcn "new-york" refresh broke three compositions:

- **Flat-field forms** (custom screens like the money-horse credit calculator pass
  bare `<Field>` children, no `<Section>`) drew a divider line between *every* field
  and rendered edge-to-edge. The form body now scopes dividers to consecutive
  `<section>` children only and pads flat children — sectioned auto-UI edit forms are
  unchanged.
- **Auth screens** render `<Form>` inside `<AuthCard>`; the self-carding form produced
  a card-in-card. `AuthCard` now wraps its children in the new exported
  `BareFormProvider`, so `DefaultForm` renders a bare stacked `<form>` when embedded.
- **NAV_ICONS** was missing `layers` and `building`, so those nav entries fell back to
  the dot. Both lucide icons are now registered.
