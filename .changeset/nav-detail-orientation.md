---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Fix a double orientation loss (fw#2724): navigating from a list into a sub-screen that has no nav entry of its own (an `entityEdit`/`actionForm` reached via a row action, for example) used to mark nothing in the sidebar AND shrink the breadcrumb to a single crumb — nearly every non-nav-listed screen in a real consumer app.

- `listScreenId` (already available on `custom`/`projectionDetail`) is now also accepted on `entityEdit` and `actionForm` screens, naming the parent list screen for breadcrumb and nav-highlight resolution.
- An explicit `listScreenId` now wins over the existing rowAction/entity-list heuristics on every screen type that carries it (previously the heuristic could override a declared `listScreenId` on `custom`/`projectionDetail`; both resolutions agree on every screen shipped in bundled-features, so no visible change there).
- `NavTree`'s active-item marking now shares this exact resolution with the breadcrumb (`resolveParentScreenId` in `shell-breadcrumb.ts`): when the routed screen has no node of its own in the nav tree, the resolved parent's nav entry is highlighted instead of nothing. `aria-current="page"` stays reserved for the screen that IS the routed one — the parent-fallback match gets the visual highlight only, not that assertion.
- This is a visible behavior change for existing apps, by design: any `entityEdit` screen without its own nav entry that shares an entity with a listed `entityList` (or is a rowAction target of one) now lights up that list's nav entry — nothing needs to be declared for this, the existing heuristic just now also drives nav highlighting, not only the breadcrumb.
