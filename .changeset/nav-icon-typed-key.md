---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

`NavDefinition.icon`, `ContentCollectionDefinition.nav.icon`, `ScreenNavSugar.icon` and `ConfigMask.icon` were all `icon?: string` — any typo (`icon: "seting"`) compiled fine and silently fell back to a dot in the sidebar. New `NavIconKey` union (`@cosmicdrift/kumiko-types/nav-icon`, re-exported from `@cosmicdrift/kumiko-framework/{engine,ui-types}`) types all four against the closed set of keys the web renderer actually registers, so an unregistered icon key is now a compile error at the `r.nav()`/`r.screen({ nav })`/config-mask call site instead of a missing icon at runtime.

`packages/renderer-web`'s `NAV_ICONS` map is checked against the same union via `as const satisfies Record<NavIconKey, …>`, so the type and the map can no longer drift — adding a key requires updating both in the same change. This also surfaced a real pre-existing gap: `tenant-settings` declared `icon: "languages"`, which had never been a registered key (silently rendered as a dot); `languages` (lucide `Languages`) is now registered.

This is a breaking type change for any app that passes an icon key outside the vocabulary in `packages/types/src/nav-icon.ts` — such a call site will fail to compile after this bump.
