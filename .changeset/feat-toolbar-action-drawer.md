---
"@cosmicdrift/kumiko-framework": minor
---

fw#2225: `ToolbarAction` gains a third variant, `kind: "drawer"`, alongside `navigate` and `writeHandler`. It references an `actionForm` screen by id; clicking the toolbar button mounts that actionForm inline in a slide-in Drawer instead of navigating to a full page. A successful submit closes the Drawer and reloads the underlying list; Cancel closes it without navigating. The boot validator rejects a `screen` reference that doesn't resolve to a same-feature `actionForm` screen, and access is enforced exactly like `kind: "navigate"` — the toolbar button stays visible, but the Drawer shows an access-denied state instead of the form when the user lacks the target screen's role.

A new optional `Drawer` Core-Primitive backs this (`packages/renderer-web` wires it to the existing `widgets/drawer.tsx` `Drawer`); apps on an older `PrimitivesRegistry` without it simply don't render the drawer-kind button.
