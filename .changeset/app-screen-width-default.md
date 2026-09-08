---
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-types": patch
---

Add an app-wide `screenWidth` option to `createKumikoApp` so a consumer can set the default width for every form/detail screen that doesn't set its own `layout.width`, instead of forking every bundled-feature screen it doesn't own to change one Tailwind class. `FormScreenShell` now reads its default from a `ScreenWidthProvider` context (exported from `@cosmicdrift/kumiko-renderer-web`) instead of a hardcoded `max-w-4xl`; per-screen `layout.width` still wins over the app default. Behavior is unchanged for apps that don't pass `screenWidth` (default stays `"4xl"`).

Also removes the now-redundant hardcoded `maxWidth` on the bundled `profile`, `privacy-center`, `tier-admin`, and admin-shell overview screens so they inherit the app default too.

Fixes the Cancel button on form/detail screens having no visible hover state: it used the `link` button variant, which strips the button's box (`h-auto px-0 py-0`); it now uses `secondary` (outline + `hover:bg-accent`) like the framework's other secondary actions.

Fixes the profile screen's email/password row rendering as two unevenly sized cards followed by a stray full-width row: `items-start` opted the row out of the grid's default stretch behavior, so two cards of different content height sat at their own heights instead of matching each other.
