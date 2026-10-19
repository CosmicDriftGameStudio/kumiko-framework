// Asset-Resolver — the layer between "qualified asset name" and "URL the
// renderer can point an <img>/<Image> at". An asset (logo, illustration,
// icon bundle) is declared by a feature with a qualified name
// ("admin:asset:hero-logo") and resolved at render-time against the
// current tenant / theme / platform.
//
// Why a resolver indirection:
//   - Tenant-theming (different logo per tenant) without the feature
//     knowing what tenant it's rendering for.
//   - Dark-mode / light-mode variants picked up from the current theme
//     context.
//   - Web vs mobile different asset bundles (e.g. PNG vs SVG).
//
// The app registers a concrete resolver on startup and hands it to the
// renderer via context. Feature code calls `useAsset("admin:asset:logo")`
// (renderer-side hook) → internally `AssetResolver.resolve(qn)`.

// Render-context the resolver may consult. Everything here is optional;
// the default resolver ignores fields it doesn't use.
export type AssetResolveContext = {
  readonly tenantId?: string;
  readonly theme?: "light" | "dark";
  readonly platform?: "web" | "ios" | "android";
  readonly locale?: string;
};

export type AssetResolution = {
  // Final URL / URI — web uses https://, Expo uses local file:// or
  // remote https://, SSR may get a data: URI for inlined critical
  // assets.
  readonly uri: string;
  // Optional pre-computed dimensions so the renderer can reserve layout
  // space without a first-paint reflow (fixes the image-loads-then-
  // layout-jumps UX on mobile).
  readonly width?: number;
  readonly height?: number;
  // Alt-text to apply when the asset renders into an <img>. The i18n
  // layer resolved it to a string before the resolver returned.
  readonly alt?: string;
};

export type AssetResolver = {
  // Returns null when the asset isn't known; renderer shows a fallback
  // (missing-image placeholder) instead of crashing. Kumiko's standard
  // renderer logs a warn when it sees null so features catch typos in
  // the asset qualified name early.
  resolve(qn: string, ctx?: AssetResolveContext): AssetResolution | null;
};
