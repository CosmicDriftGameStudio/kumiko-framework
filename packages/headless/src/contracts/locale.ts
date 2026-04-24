// Locale-Resolver — translation lookup + language/region info the
// renderer needs. Sits in front of i18next (or whatever i18n library
// the app wires up). ui-core calls it generically so form-controller,
// view-model, and nav-resolver all produce already-translated strings
// to hand to the renderer.
//
// The framework already has an i18n layer (@kumiko/framework/i18n) that
// features register translations against. This contract is what ui-core
// consumes — the app's entrypoint instantiates the resolver from a
// framework i18next instance and passes it to the renderer via context.

export type LocaleResolver = {
  // Resolve an i18n key to a localized string. `params` are interpolated
  // (`{name}` → params.name) — same semantics as i18next t().
  translate(key: string, params?: Readonly<Record<string, unknown>>): string;
  // Current locale in BCP-47 form (e.g. "de-AT", "en-US"). Feature code
  // that does manual formatting (e.g. a custom number renderer) reads
  // this instead of calling translate() on a placeholder.
  locale(): string;
  // Preferred time-zone for the current user. Time-zone-aware fields
  // (Kumiko's locatedTimestamp) render in this zone unless the entity
  // overrides it with a per-row locatedBy reference.
  timeZone(): string;
  // Subscribe to locale/timezone changes. Hooks (useTranslation) rely
  // on this so a user switching language mid-session triggers a
  // re-render across every subscribed consumer.
  subscribe(listener: () => void): () => void;
  // Optional — when present, the resolver is stateful and callers (like
  // a language-picker UI) can trigger a locale change that will be
  // broadcast via `subscribe`. Static resolvers (e.g. server-side
  // render with a fixed locale) omit it.
  setLocale?(locale: string): void;
};
