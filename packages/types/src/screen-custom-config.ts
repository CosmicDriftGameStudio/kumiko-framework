import type { FieldDefinition } from "./fields.ts";
import type { AccessRule, AgentScreenHints } from "./handlers.ts";
import type { PlatformComponent, ScreenNavSugar, ScreenSlots } from "./screen.ts";
import type { ScreenVisibility } from "./screen-dashboard.ts";
import type { EditLayout } from "./screen-entity-edit.ts";
import type { ScreenFallback } from "./screen-fallback.ts";

// --- custom ---

// Sub-route declared by a custom screen (Expo Router / URL-routing use).
// `path` is the route-segment appended to the screen's own path; the
// framework owns the outer routing. Components stay opaque.
export type CustomScreenRoute = {
  readonly path: string;
  readonly component: PlatformComponent;
};

export type CustomScreenDefinition = {
  readonly id: string;
  readonly type: "custom";
  readonly nav?: ScreenNavSugar;
  readonly detailFor?: string;
  readonly description?: string;
  readonly agent?: AgentScreenHints;
  readonly renderer: PlatformComponent;
  readonly routes?: readonly CustomScreenRoute[];
  /** Parent list screen for breadcrumb when this detail is not in nav. */
  readonly listScreenId?: string;
  readonly access?: AccessRule;
  /** This screen is registered without a self-owned `r.nav()` entry by
   *  design — an app opts in by navving it explicitly (e.g. a settings-area
   *  self-service screen). `createKumikoApp`'s boot diagnostic skips dormant
   *  screens instead of flagging every consumer that doesn't mount the client
   *  plugin as a false positive. Only set this on screens the feature itself
   *  never navs — a screen the feature DOES nav still needs its client plugin
   *  mounted by every consumer, and should keep triggering the diagnostic if
   *  it's missing. Also gates the boot-validator's nav-area check, same as
   *  `dormant` on other screens. */
  readonly dormant?: boolean;
  /** UI-only gate, also on direct URL access; handlers still enforce access. Unmet or failed renders `fallback`. */
  readonly visibleWhen?: ScreenVisibility;
  /** Same-feature short id or cross-feature QN `<feature>:screen:<id>` shown when `visibleWhen` is unmet (default: standard notice). */
  readonly fallback?: ScreenFallback;
};

// --- configEdit ---

// Form screen that reads and writes the tenant/user/system settings of the
// bundled config feature. Rendered like an EntityEditScreen (sections +
// fields), but:
//   - detail load via `config:query:values` (instead of `<entity>:detail`)
//   - pre-fill uses `configKeys[shortName]` → qualified key, then
//     `values[qualifiedKey].value`
//   - submit fires one `config:write:set` per changed field with
//     {key, value, scope}; the config feature treats each key as its own
//     aggregate (configValue.<keyHash>) and all N writes run in parallel
//     (Promise.all). Idempotent per key → retry safe.
//   - no singleton hack needed: per (key+tenantId) there is by design
//     exactly one row, the bridge pattern from the branding MVP goes away
//
// Partial-failure semantics: if one of N parallel writes fails, the others
// stay committed (per aggregate, no multi-stream rollback). The form stays
// dirty until the user retries — the writes that already succeeded then fire
// again with the same value. For `text` / `number` / `boolean` keys that is
// idempotent. Whoever builds a ConfigKey with a non-idempotent setter
// (counter, append-only list, etc.) must ensure idempotency in the setter.
//
// Field shape: inline on the screen like `actionForm`. The author thereby
// controls the input type (text/number/select/...) without resolve
// ceremony — the FieldDefinitions are the same as on entities, all
// DefaultInput renderers apply unchanged. Field labels go through the
// existing i18n conventions (`<feature>:entity:<namespace>:field:<name>`
// etc. — the author chooses the namespace).
//
// scope MUST match the `createTenantConfig`/`createSystemConfig`/
// `createUserConfig` declaration of the referenced keys — the boot
// validator pins that.
/** A button row on a configEdit form that calls a write handler with `{}` (for example "send a test").
 *  It never saves the form: the button is disabled while the form has unsaved changes, so the
 *  handler always works on what is stored. All text fields are i18n keys. */
export type ConfigEditAction = {
  /** Unique within the screen; used for the test id. */
  readonly id: string;
  /** Qualified name of a write handler (`<feature>:write:<name>`). */
  readonly handler: string;
  readonly label: string;
  readonly description?: string;
  readonly buttonLabel: string;
  /** Field (from the layout) after which the row is drawn. */
  readonly afterField: string;
  /** Shown after a successful call; without it a success stays silent. */
  readonly successMessage?: string;
};

export type ConfigEditScreenDefinition = {
  readonly id: string;
  readonly type: "configEdit";
  /** Default true: the form fills the shell content height with a pinned
   *  footer. `false` restores the card layout with the footer in the flow. */
  readonly fillHeight?: boolean;
  readonly nav?: ScreenNavSugar;
  readonly detailFor?: string;
  readonly description?: string;
  readonly agent?: AgentScreenHints;
  /** Screen has no nav entry by design (opened via link or navved by the
   *  app); exempts it from the nav-area boot check. */
  readonly dormant?: boolean;
  /** UI-only gate, also on direct URL access; handlers still enforce access. Unmet or failed renders `fallback`. */
  readonly visibleWhen?: ScreenVisibility;
  /** Same-feature short id or cross-feature QN `<feature>:screen:<id>` shown when `visibleWhen` is unmet (default: standard notice). */
  readonly fallback?: ScreenFallback;
  /** scope for config:write:set calls. Must match the scope declaration of
   *  the keys referenced in `configKeys` — the boot validator checks that
   *  against the registry. */
  readonly scope: "tenant" | "system" | "user";
  /** Map: form field name (short, as referenced in the layout) → fully
   *  qualified config key (`<feature>:config:<short>`). The boot validator
   *  checks that every qualified key is known in the registry. */
  readonly configKeys: Readonly<Record<string, string>>;
  /** Field name → qualified secret key (`<feature>:secret:<short>`), tenant or system scope
   *  (system: platform-wide, SystemAdmin only), never user scope.
   *  Such a field is a writeOnly text field with no `configKeys` entry; the same save
   *  writes it through secrets:write:set (or secrets:write:delete on removal). */
  readonly secretKeys?: Readonly<Record<string, string>>;
  /** Form shape per field name. Same FieldDefinitions as on
   *  entities/ActionForm. Field names match the keys in `configKeys`
   *  — the boot validator pins that. */
  readonly fields: Readonly<Record<string, FieldDefinition>>;
  /** Layout: sections with field refs. Identical to entityEdit/
   *  actionForm. */
  readonly layout: EditLayout;
  /** Optional per-field label i18n key (field name → key). The settings
   *  hub sets the respective config key's `mask.title` here, so the label
   *  declared on the key shows up on the generated field — without
   *  duplicating it under the `__config-edit__` convention. A missing
   *  entry falls back to the convention. */
  readonly fieldLabels?: Readonly<Record<string, string>>;
  /** Per-field help text i18n key (Field-Name → Key), from `mask.description`. */
  readonly fieldDescriptions?: Readonly<Record<string, string>>;
  /** Field names whose config key declares `required: true` — drives the
   *  "Not set. Required." origin line, not form validation. */
  readonly requiredFields?: readonly string[];
  /** i18n key for the submit button. Default: "kumiko.actions.save". */
  readonly submitLabel?: string;
  /** Handler buttons drawn as their own row after `afterField` (settings-list layout). */
  readonly actions?: readonly ConfigEditAction[];
  readonly slots?: ScreenSlots;
  readonly access?: AccessRule;
};

// Self-populating counterpart of ConfigEditScreenDefinition for `r.secret(...)`
// declarations. No EditLayout/FieldDefinition — secrets never round-trip a
// stored value to the client, so the screen renders its own body (password
// inputs + redaction display + delete) instead of going through RenderEdit.
export type SecretsEditSection = {
  readonly title?: string;
  readonly fields: readonly string[];
};

export type SecretsEditScreenDefinition = {
  readonly id: string;
  readonly type: "secretsEdit";
  readonly nav?: ScreenNavSugar;
  readonly detailFor?: string;
  readonly description?: string;
  readonly agent?: AgentScreenHints;
  /** Screen has no nav entry by design (opened via link or navved by the
   *  app); exempts it from the nav-area boot check. */
  readonly dormant?: boolean;
  /** UI-only gate, also on direct URL access; handlers still enforce access. Unmet or failed renders `fallback`. */
  readonly visibleWhen?: ScreenVisibility;
  /** Same-feature short id or cross-feature QN `<feature>:screen:<id>` shown when `visibleWhen` is unmet (default: standard notice). */
  readonly fallback?: ScreenFallback;
  /** field id -> qualified secret name (`<feature>:secret:<kebab>`). */
  readonly secretKeys: Readonly<Record<string, string>>;
  /** field id -> i18n key for the label. */
  readonly fieldLabels: Readonly<Record<string, string>>;
  /** field id -> i18n key for the hint, only where the declaration carries one. */
  readonly fieldHints?: Readonly<Record<string, string>>;
  /** field ids whose declaration set `required: true`. */
  readonly requiredFields?: readonly string[];
  /** field id -> write access derived from the key's `writeRoles`. The screen
   *  hides fields the viewer fails; UI only, the secrets write gate stays
   *  authoritative. */
  readonly fieldAccess?: Readonly<Record<string, AccessRule>>;
  readonly sections: readonly SecretsEditSection[];
  readonly access?: AccessRule;
};
