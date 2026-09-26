---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

App theme as one input: `createThemePlugin` from `@cosmicdrift/kumiko-renderer-web/theme-plugin`, plus font, shadow and spacing tokens

<!-- kumiko-changes
feature: renderer
type: improvement
title: App theme as one Tailwind plugin instead of duplicated @theme and :root blocks
detail: |
  An app declares its colors (a string, or `{ light, dark }`), base radius, fonts, card shadow and card padding once in `defineAppTheme({...})`, default-exports `createThemePlugin(theme)` from e.g. `src/theme.ts`, and adds `@plugin "./theme.ts";` after the renderer-web import in its styles.css. The plugin writes into the same base layer after the framework palette, so the app values win in light and dark mode without repeating them in `:root`/`.dark`; colors the framework does not know get utilities (`bg-brand-soft`). `fonts.sans` also sets the body font. The framework's `--card-padding/--card-radius/--card-shadow` defaults moved into `@layer base` (an app's unlayered `:root` still overrides them, an app `@theme` value still does not). CoreTokens gain `font`, `shadow.card` and `spacing.card`. Apps that already duplicate their palette in unlayered `:root`/`.dark` blocks must drop those blocks when switching to the plugin, since unlayered CSS beats it.
-->
