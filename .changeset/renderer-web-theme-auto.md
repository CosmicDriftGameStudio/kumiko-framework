---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

Theme mode auto follows prefers-color-scheme

<!-- kumiko-changes
feature: renderer-web
type: added
title: Theme preference auto follows the OS color scheme live; ThemeToggle and ThemeMenuItem step through light, dark and auto, a stored choice wins, and defineAppTheme accepts defaultColorScheme
migration: |
  Apps with a theme-restore inline script in their host HTML must update it. The toggle can now store "auto", which an old script that only checks for "dark" treats as light, so dark-mode users see a light flash on load. Use the script from the comment in renderer-web tokens.ts, which also handles "auto" via matchMedia. Under a strict CSP, update the script hash or keep the nonce.
-->
