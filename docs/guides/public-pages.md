---
status: reference
verified: 2026-10-03
issue: 3309
---

# Public pages: theme, shell and building blocks

How to build a branded public page (landing, sign-in, wizard, result screen)
from the framework's building blocks. Start with the two declarative pieces,
`defineAppTheme` and `createPublicSurface`; the imperative blocks below plug
into them. Rebuilding any of these blocks in app code is an anti-pattern: the
framework versions carry the tokens, safe-area handling, accessibility and
tests.

Everything below is exported from `@cosmicdrift/kumiko-renderer-web` unless
noted. The prop types of the primitives live in `@cosmicdrift/kumiko-renderer`.

## Theme with `defineAppTheme`

The app declares its brand once as data. The Tailwind plugin turns it into CSS
variables that beat the framework's palette.

```ts illustration
// theme.ts
import {
  createThemePlugin,
  defineAppTheme,
} from "@cosmicdrift/kumiko-renderer-web/theme-plugin";

export default createThemePlugin(
  defineAppTheme({
    colors: {
      primary: { light: "#0a7d5a", dark: "#34d399" },
      "brand-soft": "#e0f5ee",
    },
    shadows: { card: "none" },
    fonts: { sans: "Manrope, sans-serif" },
  }),
);
```

```css illustration
/* styles.css */
@import "@cosmicdrift/kumiko-renderer-web/styles.css";
@plugin "./theme.ts";
@source "./src";
```

Source: `packages/server-runtime/src/__tests__/renderer-web-theme-plugin.integration.test.ts`

- `colors`: a plain string applies to both modes; `{ light, dark }` splits them,
  `dark` falls back to `light`. Names must be kebab-case. Framework names
  (`primary`, `background`, `promo`, `promo-accent`, ...) override the
  framework token; any other name (`brand-soft`) also gets a Tailwind utility
  (`bg-brand-soft`).
- `radius`, `fonts.sans | heading | mono`, `shadows.card`, `spacing.card` are
  mode-invariant. `fonts.sans` also sets the `body` font.
- Use tokens in components (`bg-primary`, `text-status-ok`), never hex values
  or palette classes.

Source: `packages/renderer-web/src/theme-plugin.ts`, tested in
`packages/renderer-web/src/__tests__/theme-plugin.test.ts`

### Migrating from `@theme` / unlayered `:root`/`.dark`

The old route (override `@theme` values plus unlayered `:root` and `.dark`
blocks in the app's `styles.css`) is superseded. `@theme` alone cannot win:
the framework's light palette sits in `@layer base :root:not(.dark)`. The
unlayered `:root` workaround worked, but it made every app repeat the palette
in two modes by hand.

1. Create `theme.ts` and move each token from the app's `@theme`, `:root` and
   `.dark` blocks into `colors` (`--color-primary` becomes `primary`, light and
   dark values become `{ light, dark }`).
2. Move `--radius`, font families and the card shadow/padding into `radius`,
   `fonts`, `shadows.card`, `spacing.card`.
3. Delete those blocks from `styles.css`; keep only
   `@import "@cosmicdrift/kumiko-renderer-web/styles.css";` and add
   `@plugin "./theme.ts";`.
4. Colors the app invented (not in the framework list) stay in `colors`; the
   plugin generates their utilities, so no extra `@theme` entry is needed.
5. Check light and dark in the browser; both modes now come from the one
   object.

## Public surface

`createPublicSurface` mounts a schema-less provider chain (locale, formality,
primitives, dispatcher, feature providers) and renders one route by exact
`pathname`. It never loads a schema, so anonymous visitors cannot see admin
navigation. Feature `gates` are ignored on purpose; an auth gate would lock the
public page behind login.

```tsx illustration
import { emailPasswordClient, SignupScreen } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import { createStaticLocaleResolver } from "@cosmicdrift/kumiko-renderer";
import { createPublicSurface } from "@cosmicdrift/kumiko-renderer-web";

createPublicSurface({
  locale: createStaticLocaleResolver({ locale: "en" }),
  clientFeatures: [emailPasswordClient()],
  routes: [{ path: "/signup", component: <SignupScreen loginHref="/login" /> }],
  fallback: <SignupScreen loginHref="/login" />,
});
```

Source: `packages/renderer-web/e2e/fixtures/signup-page.tsx`

Options: `routes`, `fallback`, `shell`, `formality`, `clientFeatures`, `locale`,
`primitives`, `dispatcher`, `rootId`. Pass `shell` to wrap every page in the
chrome from the next section.

## PublicShell

One header and footer for anonymous pages. `variant` picks the layout:

| Variant | Use for | Extra prop |
| --- | --- | --- |
| `marketing` | Landing and info pages, full-width content | `notice` (promo-tinted strip above the header) |
| `focus` | One task in a narrow column (wizard, form) | `progress` (rendered under the header, e.g. a `StepBar` or `ProgressBar`) |
| `card` | One centered card on a muted background (sign-in, sign-up, deletion) | none |

```tsx illustration
<PublicShell variant="marketing" brand={brand} notice="Kostenlos testen">
  <p>Inhalt</p>
</PublicShell>

<PublicShell variant="focus" brand={brand} progress={<ol aria-label="Fortschritt" />}>
  <p>Schritt</p>
</PublicShell>

<PublicShell variant="card" brand={brand}>
  <form aria-label="Anmelden" />
</PublicShell>
```

Source: `packages/renderer-web/src/widgets/__tests__/public-shell.test.tsx`

Hook it up through the surface, so each route does not repeat it:

```tsx illustration
createPublicSurface({
  routes,
  shell: ({ children }) => (
    <PublicShell variant="card" brand={<Logo />}>
      {children}
    </PublicShell>
  ),
});
```

Source: option shape from `packages/renderer-web/src/app/create-public-surface.tsx`

Web only: `PublicShell` is a renderer-web widget; there is no native version in
this repo.

## StepBar with back navigation

Pass `onStepSelect` and completed steps become buttons that jump back. The
current and upcoming steps stay plain text, unless `selectableSteps="all"`
makes every non-current step a target (the caller then owns validation for
forward jumps). On narrow viewports the bar shows `compactLabel`; with
`selectableSteps="all"` that label becomes a step picker.

```tsx illustration
<StepBar
  steps={["Basics", "Industry", "Review"]}
  currentIndex={1}
  compactLabel="Step 2 of 3 · Industry"
  onStepSelect={(index) => setStep(index)}
  testId="steps"
/>
```

Source: `packages/renderer-web/src/widgets/__tests__/widgets.test.tsx`

Further props: `doneSteps`, `narrowLayout` (`"label"` or `"steps"`),
`orientation` (`"horizontal"` or `"vertical"`, with `heading`, `description`,
`subtitles`). Web only (renderer-web widget).

## StickyActionBar

Thumb-reach action row. Below the `sm` breakpoint it is fixed to the bottom
edge and padded by `env(safe-area-inset-bottom)`, plus a spacer so the last
content row stays reachable; from `sm` up it renders inline. `children` are the
forward actions and share the width, `back` adds an icon-only back button.

The safe-area inset is `0` unless the page's viewport meta contains
`viewport-fit=cover`. Set it, or the home indicator covers the bar.

```tsx illustration
<StickyActionBar back={{ onBack, label: "Zurück" }} testId="bar">
  <button type="submit">Weiter</button>
</StickyActionBar>
```

Source: `packages/renderer-web/src/primitives/__tests__/public-page-primitives.test.tsx`

Web implementation: `packages/renderer-web/src/primitives/sticky-action-bar.tsx`.
It is an optional entry of `PrimitivesRegistry`, so access it through
`usePrimitives()` and narrow the `undefined`; the web default registry ships it.

## CopyButton, ShareButton, buildWhatsAppShareUrl

- `CopyButton` writes `text` to the clipboard and flips its label to
  `copiedLabel` for two seconds. If the clipboard is denied (insecure context,
  permission), the label does not flip.
- `ShareButton target="whatsapp"` renders a new-tab `wa.me` link with `text`
  prefilled; with `phone` (international form, `+` or `00` prefix accepted) it
  opens that chat, without it WhatsApp's contact picker.
- `ShareButton target="system"` opens the browser share sheet
  (`navigator.share`) and renders nothing where the browser has none, so never
  make it the only way to share.
- `buildWhatsAppShareUrl(text, phone?)` from `@cosmicdrift/kumiko-renderer`
  builds the same link for custom markup.

```tsx illustration
<ShareButton
  target="whatsapp"
  text="Frisch reingekommen"
  phone="+49 171 2345678"
  label="In WhatsApp teilen"
/>

<ShareButton
  target="system"
  text="Octavia"
  title="Škoda"
  url="https://example.test/v/1"
  label="Teilen"
/>

<CopyButton text={"Zeile 1\nZeile 2"} label="Text kopieren" copiedLabel="Kopiert" />
```

Source: `packages/renderer-web/src/primitives/__tests__/public-page-primitives.test.tsx`

Clipboard and share sheet are browser APIs implemented in
`packages/renderer-web/src/primitives/share-actions.tsx`. `CopyButton` and
`ShareButton` are optional `PrimitivesRegistry` entries (use `usePrimitives()`);
`className` is merged on web only (the prop docs say native implementations
ignore it). This repo has no native implementation of them.

## PhotoSlots

Guided photo capture: one tile per requested shot in a two-column grid, each
its own camera/gallery picker. The app owns storage: `onUpload(slotId, file)`
must throw on failure (the message shows under the slot) and the app then sets
the slot's `previewUrl`. Images are resized in the browser before `onUpload`.

```tsx illustration
<PhotoSlots
  slots={[
    { id: "front", label: "Front, angled", previewUrl: photos.front, badge: "Cover photo" },
    { id: "rear", label: "Rear" },
  ]}
  onUpload={async (slotId, file) => {
    await storePhoto(slotId, file);
  }}
  pickHint="Camera or gallery"
  capture="environment"
/>
```

Source: props from `packages/renderer-web/src/widgets/photo-slots.tsx`, behavior
in `packages/renderer-web/src/widgets/__tests__/photo-slots.test.tsx`

Web only (`<input type="file">`, browser-side resize). `capture` opens the camera
directly on phones. The first slot spans the full row unless
`featureFirst={false}`.

## PromoPanel

Offer surface for upsells ("create an account"): own tinted panel (tokens
`promo`, `promo-foreground`, `promo-accent`, `promo-accent-foreground`) so an
offer never reads like an info or error banner. One call to action, either a
link (`href`) or a button (`onClick`). Restyle it through the promo tokens in
`defineAppTheme`, not with a custom component.

```tsx illustration
<PromoPanel
  eyebrow="Das war ein Kanal"
  title="Mit Konto erreicht dieser Octavia alle Kanäle."
  action={{ label: "Kostenloses Konto sichern", href: "/signup", testId: "promo-cta" }}
  testId="promo"
>
  <p>Kampagne über bis zu 60 Tage.</p>
</PromoPanel>
```

Source: `packages/renderer-web/src/primitives/__tests__/public-page-primitives.test.tsx`

Optional `PrimitivesRegistry` entry; implementation in
`packages/renderer-web/src/primitives/promo-panel.tsx`. No native
implementation in this repo.

## Formality (Sie/Du per locale)

`createPublicSurface({ formality })` wraps the surface in `FormalityProvider`.
Default is `"informal"`. Under `"formal"`, `t()` prefers `<locale>-x-formal`
entries over the plain `<locale>` ones, across all bundles. For German the tag
is `"de-x-formal"`; `@cosmicdrift/kumiko-locale-de` ships the framework's formal
texts (`packages/locale-de/src/formal.ts`).

```tsx illustration
const withGreeting: ClientFeatureDefinition = {
  name: "greeting",
  translations: {
    de: { "public.greeting": "Schön, dass du da bist" },
    "de-x-formal": { "public.greeting": "Schön, dass Sie da sind" },
  },
};

createPublicSurface({
  locale: createStaticLocaleResolver({ locale: "de" }),
  clientFeatures: [withGreeting],
  formality: "formal",
  routes: [{ path: "/", component: <Greeting /> }],
});
```

Source: `packages/renderer-web/src/__tests__/create-public-surface.test.tsx`

An app override of a framework key in `"de"` also needs a `"de-x-formal"`
entry. Otherwise the framework's formal text wins in formal mode, because the
formal tier is searched before any plain tier. Locales without an `-x-formal`
variant fall back to the plain text.

## ProgressBar tone

`ProgressBar` takes `value` (0..1, clamped) and `tone`: `"default"` (primary),
`"success"` (`status-ok`), `"warn"`, `"danger"`. Use `success` for a completed
or all-good state; do not recolor with `className`.

```tsx illustration
<ProgressBar value={done / total} tone={done === total ? "success" : "default"} ariaLabel="Fortschritt" />
```

Source: props from `packages/renderer-web/src/widgets/progress-bar.tsx`

`size="thin"` gives a quiet 4px inline bar. Web only (renderer-web widget).

## `excludeFields` on generic create/update

When a public or wizard flow collects only part of an entity, the generic
handlers can drop fields with `excludeFields` (`{ create: [...], update: [...] }`
on the entity handlers; see `EntityWriteHandlerOptions` in
`packages/types/src/entity-handlers.ts`). It protects the payload only: a
payload that still carries the field fails validation. It does not hide or lock
the field in the UI. On generic edit screens, mark the field read-only as well,
or users can still edit it there.

## Reference

| Block | Purpose | Main props |
| --- | --- | --- |
| `defineAppTheme` / `createThemePlugin` | App brand as data, applied through Tailwind `@plugin` | `colors`, `radius`, `fonts`, `shadows.card`, `spacing.card` |
| `createPublicSurface` | Schema-less mount for anonymous pages | `routes`, `fallback`, `shell`, `formality`, `clientFeatures`, `locale`, `dispatcher` |
| `PublicShell` | Header/footer chrome | `variant` (`marketing` \| `focus` \| `card`), `brand`, `headerActions`, `footer`, `notice` (marketing), `progress` (focus) |
| `StepBar` | Wizard step overview with jump-back | `steps`, `currentIndex`, `compactLabel`, `onStepSelect`, `selectableSteps`, `doneSteps` |
| `StickyActionBar` | Bottom-pinned action row with safe area | `children`, `back: { onBack, label }` |
| `CopyButton` | Copy text with confirmation | `text`, `label`, `copiedLabel`, `variant` |
| `ShareButton` | WhatsApp link or system share sheet | `target`, `text`, `label`; `phone` (whatsapp); `title`, `url` (system) |
| `buildWhatsAppShareUrl` | `wa.me` URL builder | `(text, phone?)` |
| `PhotoSlots` | Guided photo capture grid | `slots`, `onUpload`, `capture`, `accept`, `featureFirst`, `pickHint` |
| `PromoPanel` | Tinted offer surface | `title`, `eyebrow`, `children`, `action` (`href` or `onClick`) |
| `FormalityProvider` | Sie/Du wording for a subtree | `formality` (`"formal"` \| `"informal"`) |
| `ProgressBar` | Progress 0..1 | `value`, `tone`, `size`, `ariaLabel` |

Platform: every block above is implemented in `@cosmicdrift/kumiko-renderer-web`
only. The prop contracts for `StepBar`, `StickyActionBar`, `CopyButton`,
`ShareButton` and `PromoPanel` live in `@cosmicdrift/kumiko-renderer`, so a
native renderer can implement them; none exists in this repo.
