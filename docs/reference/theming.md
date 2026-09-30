---
status: reference
verified: 2026-09-30
evidence: "kumiko-framework#3381 (warm-neutral tokens, IBM Plex, sidebar tokens); packages/renderer-web/src/styles.css; packages/renderer-web/src/__tests__/token-contrast.test.ts"
---

# Theming: design tokens, fonts and app overrides

`@cosmicdrift/kumiko-renderer-web/styles.css` defines every color, radius and font as a CSS variable. Screens and widgets only use the tokens, so an app re-brands by overriding variables and never touches component CSS.

## Token roles (light)

| Role | Token | Value |
|---|---|---|
| Surface (content, header, toolbar, cards) | `--color-card` | `#FFFFFF` |
| Page | `--color-background` | `#F3F2EE` |
| Sunken (table head, hover, input fill) | `--color-muted`, `--color-secondary`, `--color-accent` | `#F6F5F1` |
| Line | `--color-border` | `#E2E0D9` |
| Strong line (search, filter buttons) | `--color-border-strong` | `#CFCCC3` |
| Row line | `--color-border-row` | `#ECEAE4` |
| Control border (inputs, action buttons) | `--color-input` | `#908D85` |
| Text | `--color-foreground` | `#1A1C1E` |
| Text 2 | `--color-foreground-secondary` | `#474B50` |
| Text 3 | `--color-muted-foreground` | `#5F6368` |
| Disabled | `--color-foreground-disabled` | `#8A8E93` |
| Destructive | `--color-destructive` | `#9B2C23` |

Status colors come as a text token and a surface token: `--color-status-ok` (`#1D5E36` on `#E6F2EA`), `--color-status-warn` (`#7A4B00` on `#FBF0D9`), `--color-status-bad` (`#9B2C23` on `#F9E5E2`), `--color-status-critical` and `--color-status-neutral` (`#474B50` on `#F0EEE8`). The surface tokens are `--color-status-<tone>-surface`. `primary` is the text tone by default; apps set their brand color there.

Sidebar tokens: `--color-sidebar`, `-foreground`, `-primary`, `-primary-foreground`, `-accent` (active item), `-accent-foreground`, `-muted` (secondary text), `-input` (search field), `-border`, `-ring`. The light default sidebar uses the page color. The sidebar is 232px wide.

## Dark theme

Dark uses the same roles with its own values (page `#121211`, surface `#1A1A19`, sunken `#232321`, text `#ECEBE7`). Every text role on its surface keeps a contrast of at least 4.5:1; `token-contrast.test.ts` checks the pairs, so extend it when you add a pair.

## Radius, numbers, fonts

- `--radius` is `0.5rem`. Controls use `rounded-md` (6px), pills use `rounded-full`.
- Numbers, dates and money render with `tabular-nums`.
- IBM Plex Sans (400, 500, 600) and IBM Plex Mono (400, 500) ship inside `renderer-web` under the SIL Open Font License (`src/fonts/OFL.txt`). They are self-hosted, so `font-src 'self'` is enough. The dev server and the production build of `server-runtime` serve them under `/assets/kumiko/fonts/`.
- Override the fonts with `--font-sans` and `--font-mono`. Apps that want Inter set `--font-sans` and load the font themselves.

## App override

Override tokens in the app's own `styles.css`. Unlayered rules beat the framework's `@layer base` light block and its `@theme` defaults, so plain `:root` and `:root:not(.dark)` selectors are enough. This is the walkthrough sample's brand override (source: `samples/apps/ui-walkthrough/src/styles.css`):

```css
@import "@cosmicdrift/kumiko-renderer-web/styles.css";

@source "./**/*.{ts,tsx}";

/* Solon brand: token overrides only. Unlayered rules beat the framework's
   `@layer base` light-mode block and its @theme defaults. */
:root {
  --color-sidebar: #172430;
  --color-sidebar-foreground: #dce4e8;
  --color-sidebar-muted: #a9b8c1;
  --color-sidebar-input: #22323f;
  --color-sidebar-primary: #24566a;
  --color-sidebar-primary-foreground: #ffffff;
  --color-sidebar-accent: #24566a;
  --color-sidebar-accent-foreground: #ffffff;
  --color-sidebar-border: #22323f;
  --color-sidebar-ring: #205265;
}

:root:not(.dark) {
  --color-primary: #205265;
  --color-primary-foreground: #ffffff;
  --color-ring: #205265;
}
```

The programmatic route is `createThemePlugin(theme)` from `@cosmicdrift/kumiko-renderer-web/theme-plugin`. The walkthrough sample (`samples/apps/ui-walkthrough`) shows all screens on these tokens.
