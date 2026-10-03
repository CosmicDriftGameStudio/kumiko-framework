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
  No code change needed. The toggle now has a third step. To avoid a flash on load, extend the inline script in the host HTML as documented in renderer-web tokens.ts so it also honors the stored value auto.
-->
