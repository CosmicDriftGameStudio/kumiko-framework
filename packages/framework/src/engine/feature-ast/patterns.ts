// FeaturePattern — typed representation of an `r.*` call inside a
// feature file. The AST visitor (parse.ts) walks the
// `defineFeature(name, (r) => { ... })` setup callback and yields one
// FeaturePattern per recognised call.
//
// **Doc single-source:** THIS file is the canonical pattern reference
// (mirrored into docs/corpus). The FeatureRegistrar JSDoc in
// types/feature.ts stays a short pointer — duplicating semantics there
// has already drifted once; verify any "checks at boot" claim against
// engine/boot-validator/* before writing it down.
//
// **Design principle:**
//
//   - Whatever the Designer/AI can edit declaratively → typed static
//     fields, reusing the existing engine/types definitions so the
//     pattern shape never drifts from the runtime contract.
//   - Whatever carries closures/code → SourceLocation pointing at the
//     opaque region. The Designer renders that as a read-only code
//     block; the AI patcher overwrites the span verbatim.
//
// **Coverage = 100%.** Calls we don't recognise become UnknownPattern
// (the Designer shows "custom call", AI leaves them alone). Custom
// TypeScript code BETWEEN `r.*` calls (helpers, local consts, imports)
// is not extracted — it stays in the file buffer and survives every
// patch unchanged.
//
// **Extension point.** Adding a new r.* API → new pattern type here +
// new extractor in parse.ts. The discriminated union forces every
// consumer (Designer, AI patcher, MCP server) to handle the new kind
// at compile time.
//
// **Naming convention.** Pattern `kind` matches the r.* method name
// 1:1 (e.g. `r.writeHandler` → `kind: "writeHandler"`). No kebab/camel
// translation layer.
//
// **Adding a new FeaturePattern kind — full consumer cascade.** The
// extension-point is wider than just this file + the parser. Update
// ALL of these when introducing a new r.* API, otherwise tests/checks
// catch the drift but the call-site jumps across files:
//   1. patterns.ts (this file): Pattern type + add to FeaturePattern
//      union + getEditability switch
//   2. feature-ast/extractors.ts: extract<Kind> function + import in
//      patterns-import-block
//   3. feature-ast/parse.ts: dispatcher case + import
//   4. feature-ast/render.ts: render<Kind> function + import + switch
//      case
//   5. feature-ast/patch.ts: PatternId variant; if singleton-per-feature
//      add to SINGLETON_KINDS; callMatchesId case
//   6. pattern-library/library.ts: <kind>Schema + entry in
//      PATTERN_LIBRARY map
//   7. pattern-library/__tests__/library.test.ts: ALL_KINDS array +
//      makePlaceholderPattern case
// TS-exhaustiveness catches most omissions automatically (1, 3, 4, 5,
// 7-via-makePlaceholderPattern), but the runtime-checked maps in 6 +
// the ALL_KINDS array in 7 are silent if forgotten — pin them with the
// library.test.ts coverage tests.

import type { LifecycleHookType } from "../constants";
import type {
  ConfigKeyDefinition,
  ConfigKeyType,
  JobDefinition,
  ReferenceDataDef,
  RunIn,
  TranslationKeys,
} from "../types/config";
import type { MetricOptions, SecretOptions } from "../types/feature";
import type { EntityDefinition } from "../types/fields";
import type { AccessRule, ClaimKeyType, RateLimitOption } from "../types/handlers";
import type { HookPhase } from "../types/hooks";
import type { HttpRouteMethod } from "../types/http-route";
import type { NavDefinition } from "../types/nav";
import type { MspErrorMode } from "../types/projection";
import type { RelationDefinition } from "../types/relations";
import type { ScreenDefinition } from "../types/screen";
import type { TreeActionDef } from "../types/tree-node";
import type { WorkspaceDefinition } from "../types/workspace";
import type { SourceLocation } from "./source-location";

// =============================================================================
// Static patterns — fully declarative. Designer renders forms, AI
// generates them as pure data. Round-trip without code spans.
// =============================================================================

// `r.entity(name, definition)` — declares an event-sourced entity: field
// schema plus search/sort and PII metadata as one declarative object. The
// framework derives the aggregate table, CRUD events, and the read-side
// projection from it at boot. Fully static — the Designer renders it as a
// form, the AI patcher edits it as pure data.
export type EntityPattern = {
  readonly kind: "entity";
  readonly source: SourceLocation;
  readonly entityName: string;
  readonly definition: EntityDefinition;
};

// `r.relation(entity, relationName, definition)` — attaches a named
// relationship to an entity: `belongsTo`, `hasMany`, or `manyToMany`
// (discriminated by `type`). Each variant carries the target entity plus
// its own extras: foreign key or join table, cascade behaviour (`onDelete`
// — parent-side only, not on `belongsTo`), search includes, opt-in
// `nestedWrite` expansion. Boot-validation checks that every target
// resolves to a registered entity (cross-feature targets allowed).
export type RelationPattern = {
  readonly kind: "relation";
  readonly source: SourceLocation;
  readonly entityName: string;
  readonly relationName: string;
  readonly definition: RelationDefinition;
};

// `r.nav(definition)` — registers a nav entry under the feature-local short
// id (qualified to `<feature>:nav:<id>`). Boot-validation checks that the
// referenced `screen` and `parent` exist (cross-feature QNs allowed) and
// that parent chains contain no cycles.
export type NavPattern = {
  readonly kind: "nav";
  readonly source: SourceLocation;
  readonly definition: NavDefinition;
};

// `r.workspace(definition)` — registers a workspace, a persona-/role-scoped
// UI surface (qualified to `<feature>:workspace:<id>`). Pure UI composition;
// boot-validation checks that nav refs exist and that at most one workspace
// per app declares `default: true`.
export type WorkspacePattern = {
  readonly kind: "workspace";
  readonly source: SourceLocation;
  readonly definition: WorkspaceDefinition;
};

// `r.config({ keys, seeds? })` — declares per-tenant config keys and returns
// a handle map; passing a handle to `ctx.config(handle)` narrows the value
// type by the key's declared `type`. Optional `seeds` write boot-time rows
// via the event-store executor (system-tenant by default, explicit
// `tenantId` per seed) — idempotent, skipped when the stream already exists.
export type ConfigPattern = {
  readonly kind: "config";
  readonly source: SourceLocation;
  readonly keys: Readonly<Record<string, ConfigKeyDefinition<ConfigKeyType>>>;
};

// `r.translations({ keys })` — registers locale-keyed string maps
// (`key → { locale → text }`). The registry namespaces every key by feature
// (`<feature>:<key>`), so short keys never collide across features;
// `createI18n` consumes the merged map with default-locale fallback.
// Multiple calls per feature merge, last write wins per key.
export type TranslationsPattern = {
  readonly kind: "translations";
  readonly source: SourceLocation;
  readonly keys: TranslationKeys;
};

// `r.requires(...featureNames)` — hard dependency on other features; boot
// fails when one is missing from the app composition. Callable-plus-
// namespace: `r.requires.projection(table)` allow-lists a read-side table
// for pipeline-step writes, `r.requires.step(kind)` opts into Tier-2 step
// kinds.
export type RequiresPattern = {
  readonly kind: "requires";
  readonly source: SourceLocation;
  readonly featureNames: readonly string[];
};

// `r.optionalRequires(...featureNames)` — soft dependency: the feature
// integrates with the named features when they are mounted but boots fine
// without them. For cross-cutting integrations (audit, notifications) that
// degrade gracefully.
export type OptionalRequiresPattern = {
  readonly kind: "optionalRequires";
  readonly source: SourceLocation;
  readonly featureNames: readonly string[];
};

// `r.systemScope()` — switches the feature's `TenantDb` to system mode: no
// tenant filter on reads/updates/deletes, and INSERT treats `tenantId` as a
// default the handler may override (tenant mode forces it). For features
// whose aggregates span tenants, e.g. user management or platform
// operations. Marker call — no arguments.
export type SystemScopePattern = {
  readonly kind: "systemScope";
  readonly source: SourceLocation;
};

// `r.toggleable({ default })` — declares the feature operator-switchable via
// the feature-toggles bundled feature; `default` is the effective state when
// no global-toggle row exists. At most once per feature. Don't declare it on
// always-on core features (auth, tenant, user) — that is a bug, and nothing
// catches it at boot.
export type ToggleablePattern = {
  readonly kind: "toggleable";
  readonly source: SourceLocation;
  readonly default: boolean;
};

// `r.describe(text)` — the one-to-three-sentence docs lead for the feature
// ("what it does + when you need it"). At most once per feature, must be
// non-empty. Flows through the feature manifest into the generated
// feature-reference pages.
export type DescribePattern = {
  readonly kind: "describe";
  readonly source: SourceLocation;
  readonly text: string;
};

// `r.metric(shortName, options)` — declares a metric under its short name
// (without the `kumiko_<feature>_` prefix; the framework qualifies it at
// boot and validates snake_case + type suffix). Runtime usage:
// `ctx.metrics.inc("created_total", { status: "new" })`.
export type MetricPattern = {
  readonly kind: "metric";
  readonly source: SourceLocation;
  readonly shortName: string;
  readonly options: MetricOptions;
};

// `r.secret(shortName, options)` — declares a tenant-scoped secret key,
// qualified to `<feature>:secret:<kebab-short>` via the QN helper. Returns a
// typed handle for `ctx.secrets.get`, so feature code never retypes the
// qualified string — same ergonomics as `r.config` handles.
export type SecretPattern = {
  readonly kind: "secret";
  readonly source: SourceLocation;
  readonly shortName: string;
  readonly options: SecretOptions;
};

// `r.claimKey(shortName, { type })` — declares a session-claim key,
// qualified to `<feature>:<shortName>` (no kebab conversion — it would
// break the claim round-trip), and returns a typed handle for
// `readClaim(user, handle)`. Declaring keys also enables typo-drift
// protection: `r.authClaims` hooks returning an undeclared inner key log a
// warning (the claim still lands in the JWT — this is not strict mode).
export type ClaimKeyPattern = {
  readonly kind: "claimKey";
  readonly source: SourceLocation;
  readonly shortName: string;
  readonly claimType: ClaimKeyType;
};

// `r.referenceData(entity, rows, options?)` — declares static lookup rows
// for an entity, upserted by `seedReferenceData` (the app or dev-server
// calls it at boot — not the framework itself): insert or update by
// `upsertKey` — which defaults to the first field of the first row, so
// declare it explicitly — and never delete. New rows land under
// `SYSTEM_TENANT_ID`, i.e. global reference data, not tenant rows.
export type ReferenceDataPattern = {
  readonly kind: "referenceData";
  readonly source: SourceLocation;
  readonly entityName: string;
  readonly data: ReferenceDataDef["data"];
  readonly upsertKey?: string;
};

// `r.readsConfig(...qualifiedKeys)` — declares that this feature reads
// config keys owned by other features, in dot notation
// (`featureName.shortKey`). Boot-validation throws when a declared key does
// not exist anywhere. Purely declarative beyond that boot-time safety net —
// runtime reads still go through `ctx.config(handle)`.
export type ReadsConfigPattern = {
  readonly kind: "readsConfig";
  readonly source: SourceLocation;
  readonly qualifiedKeys: readonly string[];
};

// `r.useExtension(extensionName, entity, options?)` — opts an entity into a
// registrar extension declared via `r.extendsRegistrar`: runs its
// `onRegister`, merges its extra schema fields, and installs its entity
// hooks at registry build time. The `options` bag is passed verbatim to
// `onRegister` (per-entity configuration). Boot-validation throws when the
// extension name does not exist.
export type UseExtensionPattern = {
  readonly kind: "useExtension";
  readonly source: SourceLocation;
  readonly extensionName: string;
  readonly entityName: string;
  readonly options?: Readonly<Record<string, unknown>>;
};

// `r.treeActions({ ... })` — the schema map for visual-tree action verbs
// (action name → definition with optional typed args). Static: args are
// type samples, not runtime validators; the Designer renders a nested form
// per action. Compile-time validation happens via the exported
// `TreeActionsHandle`, not through this pattern — this is the erased
// runtime representation.
export type TreeActionsPattern = {
  readonly kind: "treeActions";
  readonly source: SourceLocation;
  readonly definitions: Readonly<Record<string, TreeActionDef>>;
};

// =============================================================================
// Mixed patterns — header (name/access/etc.) is declarative, body
// (handler/hook/apply/transform fn) is opaque. Designer renders the
// header as a form + the body as a code block. AI patcher generates
// the header as data + the body as TypeScript source.
// =============================================================================

// Path-keyed map of source locations for opaque sub-properties of an
// otherwise declarative definition (e.g. screen.rowActions[0].visible
// is a closure that lives only in monolith bundles). Keys use JSON-path
// notation so the Designer can show "this prop is custom code" at the
// exact form-field that maps to the path.
export type OpaquePropMap = Readonly<Record<string, SourceLocation>>;

// Marker emitted in `ScreenPattern.definition` wherever a closure or
// unresolvable identifier sat in the source. Designer renderers compare
// against this constant to decide "form vs read-only span" — the actual
// SourceLocation lives at the matching path in `opaqueProps`.
export const SCREEN_OPAQUE_MARKER = "$opaque" as const;
export type ScreenOpaqueMarker = typeof SCREEN_OPAQUE_MARKER;

// `r.screen(definition)` — registers a screen under the feature-local short
// id (qualified to `<feature>:screen:<id>`). Boot-validation checks that
// entity-bound screens reference a registered entity and that column/form
// field refs name real fields. Closure-valued props (visibility conditions,
// row-action payloads, custom renderers) stay opaque — see `opaqueProps`.
export type ScreenPattern = {
  readonly kind: "screen";
  readonly source: SourceLocation;
  readonly definition: ScreenDefinition;
  // Closure-typed sub-properties (FieldCondition, RowAction.payload,
  // FieldRenderer function form). Keyed by JSON path inside the
  // definition (e.g. "rowActions.0.visible", "fields.email.renderer").
  readonly opaqueProps: OpaquePropMap;
};

// `r.writeHandler(...)` — registers a command handler: name, Zod input
// schema, handler closure, plus optional `access` and `rateLimit` rules.
// The header is declarative; schema and body stay opaque source spans.
export type WriteHandlerPattern = {
  readonly kind: "writeHandler";
  readonly source: SourceLocation;
  readonly handlerName: string;
  // schemaSource: the Zod call as source text (e.g. "z.object({...})").
  // We keep it as an opaque block instead of decoding it back to JSON
  // schema — Zod's full surface is too rich for a faithful round-trip.
  readonly schemaSource: SourceLocation;
  // handlerBody: the closure body as source text. Always opaque — AI
  // generates raw TypeScript, no DSL interpretation.
  readonly handlerBody: SourceLocation;
  readonly access?: AccessRule;
  readonly rateLimit?: RateLimitOption;
  readonly unsafeSkipTransitionGuard?: boolean;
};

// `r.queryHandler(...)` — registers a read handler: name, Zod input schema,
// handler closure, plus optional `access` and `rateLimit` rules. Read-side
// counterpart of `r.writeHandler` with the same header/body split.
export type QueryHandlerPattern = {
  readonly kind: "queryHandler";
  readonly source: SourceLocation;
  readonly handlerName: string;
  readonly schemaSource: SourceLocation;
  readonly handlerBody: SourceLocation;
  readonly access?: AccessRule;
  readonly rateLimit?: RateLimitOption;
};

// `r.hook(type, target, fn, options?)` — attaches a lifecycle hook
// (`validation`, `preSave`, `postSave`, `preDelete`, `postDelete`,
// `preQuery`, `postQuery`) to one or more target handlers. Post-hooks
// accept a `phase` option; `preDelete` always runs in-transaction — it
// guards the delete. The hook body is an opaque code span.
export type HookPattern = {
  readonly kind: "hook";
  readonly source: SourceLocation;
  readonly hookType: LifecycleHookType | "validation";
  // r.hook accepts a single target or a list; we keep both shapes so
  // the Designer can render the original author intent.
  readonly target: string | readonly string[];
  readonly fnBody: SourceLocation;
  readonly phase?: HookPhase;
};

// `r.entityHook(type, entity, fn, options?)` — like `r.hook`, but bound to
// an entity instead of individual handlers: `postSave`, `preDelete`, and
// `postDelete` fire on every matching write. The runtime API additionally
// accepts `postQuery` (fires for all query-handlers of the entity), but
// this pattern type only represents the three write-side hooks.
export type EntityHookPattern = {
  readonly kind: "entityHook";
  readonly source: SourceLocation;
  readonly hookType: "postSave" | "preDelete" | "postDelete";
  readonly entityName: string;
  readonly fnBody: SourceLocation;
  readonly phase?: HookPhase;
};

// `r.job(name, options, handler)` — registers a background job, qualified
// to `<feature>:job:<short>` and executed on a BullMQ queue outside the
// request pipeline. `trigger` is `{ on: handlerRef(s) }` (fires after the
// handler commits), `{ cron: "..." }`, or `{ manual: true }`; options cover
// concurrency modes, retries/backoff, timeout, `perTenant` fan-out, and the
// `runIn` lane (`api`/`worker`). The handler body stays an opaque code
// span.
export type JobPattern = {
  readonly kind: "job";
  readonly source: SourceLocation;
  readonly jobName: string;
  // JobDefinition without `name` (already on jobName) and without
  // `handler` (kept separately as handlerBody for opacity).
  readonly options: Omit<JobDefinition, "name" | "handler">;
  readonly handlerBody: SourceLocation;
};

// `r.notification(name, definition)` — declarative notification template,
// qualified to `<feature>:notify:<short>`. At registry build it becomes an
// after-commit postSave hook on the trigger handler that calls
// `ctx.notify(name, { to, data })`: `recipient` picks userId(s), a tenant
// broadcast, or `null` to skip; `data` builds the payload; per-channel
// `templates` (email, in-app, push) render it. Delivered by the `delivery`
// bundled feature — declare `r.requires("delivery")` alongside.
export type NotificationPattern = {
  readonly kind: "notification";
  readonly source: SourceLocation;
  readonly notificationName: string;
  readonly trigger: { readonly on: string };
  readonly recipientBody: SourceLocation;
  readonly dataBody: SourceLocation;
  // Each template (e.g. "email", "push") carries its own closure source.
  readonly templates?: Readonly<Record<string, SourceLocation>>;
};

// `r.authClaims(fn)` — contributes claims into `SessionUser.claims` whenever
// a session is issued (login AND tenant switch — claims are recomputed to
// avoid stale leaks across tenancies).
// Multiple hooks merge; keys are auto-prefixed `<feature>:<key>`, so
// cross-feature collisions are impossible by construction. Best-effort by
// design: a throwing hook logs and drops only that feature's claims — login
// still succeeds (identity facts are convenience, not access gates).
export type AuthClaimsPattern = {
  readonly kind: "authClaims";
  readonly source: SourceLocation;
  readonly fnBody: SourceLocation;
};

// `r.tree(provider)` — the feature's top-level tree provider: a subscribe
// function (emit-fn in, unsubscribe-fn out) that feeds workspaces with
// `navigation: "tree"`. Features without `r.tree()` are invisible there —
// provider presence IS the filter, there is no workspace mapping.
// Closure-only, no header form: the Designer renders a read-only code
// block, the AI patcher overwrites the span verbatim.
export type TreePattern = {
  readonly kind: "tree";
  readonly source: SourceLocation;
  readonly providerBody: SourceLocation;
};

// `r.httpRoute(definition)` — mounts an HTTP route owned by the feature,
// outside the dispatcher pipeline (not under `/api/write|query|batch`) —
// for RSS/Atom feeds, OG images, OpenAPI specs and similar. Duplicate
// method+path pairs are rejected per feature at setup time; nothing checks
// across features.
export type HttpRoutePattern = {
  readonly kind: "httpRoute";
  readonly source: SourceLocation;
  readonly method: HttpRouteMethod;
  readonly path: string;
  readonly anonymous?: boolean;
  readonly handlerBody: SourceLocation;
};

// `r.projection(definition)` — registers a read-side projection driven by
// events of one or more source entities. Apply functions run inside the
// event-store's transaction, so the projection stays consistent with the
// events that feed it. Apply bodies are opaque code spans keyed by event
// type.
export type ProjectionPattern = {
  readonly kind: "projection";
  readonly source: SourceLocation;
  readonly name: string;
  // Entity name(s) whose events feed this projection. Disambiguated
  // from `source: SourceLocation` by the explicit `Entity` suffix.
  readonly sourceEntity: string | readonly string[];
  // Map event-type → SourceLocation of the apply closure.
  readonly applyBodies: Readonly<Record<string, SourceLocation>>;
};

// `r.multiStreamProjection(definition)` — registers a cross-aggregate async
// projection. The event-dispatcher owns delivery via a dedicated cursor:
// at-least-once, strictly ordered by event id — handlers must be idempotent.
// For views spanning many aggregate types (billing summaries, audit views,
// saga state); omit the table for pure side-effect consumers (notifications,
// webhooks, external-system sync).
export type MultiStreamProjectionPattern = {
  readonly kind: "multiStreamProjection";
  readonly source: SourceLocation;
  readonly name: string;
  readonly applyBodies: Readonly<Record<string, SourceLocation>>;
  readonly errorMode?: MspErrorMode;
  readonly runIn?: RunIn;
  readonly delivery?: "shared" | "per-instance";
};

// `r.defineEvent(name, schema, options?)` — registers an event payload
// shape and returns the qualified `EventDef`, so callers pass `.name` to
// `ctx.appendEvent` instead of hand-building `<feature>:event:<short>`.
// `options.version` declares the CURRENT schema generation (default 1);
// bump it together with an `r.eventMigration` step — the framework refuses
// to boot if the chain from 1 to the current version has gaps.
export type DefineEventPattern = {
  readonly kind: "defineEvent";
  readonly source: SourceLocation;
  readonly eventName: string;
  readonly schemaSource: SourceLocation;
  readonly version?: number;
};

// `r.eventMigration(eventName, fromVersion, toVersion, transform)` —
// registers a step-wise payload upcast for event-schema evolution.
// `toVersion` must be `fromVersion + 1`; chain larger jumps step by step.
// Transforms are pure old-payload-in/new-payload-out functions and run once
// per READ, not once per event persisted — keep them cheap.
export type EventMigrationPattern = {
  readonly kind: "eventMigration";
  readonly source: SourceLocation;
  readonly eventName: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly transformBody: SourceLocation;
};

// `r.extendsRegistrar(extensionName, def)` — declares a named, globally
// unique extension point that other features opt into per entity via
// `r.useExtension`. The def can contribute `onRegister`, extra schema
// fields (`extendSchema`), and entity hooks; wiring happens at registry
// build time.
export type ExtendsRegistrarPattern = {
  readonly kind: "extendsRegistrar";
  readonly source: SourceLocation;
  readonly extensionName: string;
  // Meta-programming surface — kept fully opaque in the MVP. The
  // Designer shows "Custom Registrar Extension"; AI leaves it alone.
  readonly defBody: SourceLocation;
};

// r.usesApi("a.b") — declarative cross-feature handler-ID dependency.
// Boot-validation throws if no other feature exposes the handler. Single
// string argument; pattern is purely declarative.
export type UsesApiPattern = {
  readonly kind: "usesApi";
  readonly source: SourceLocation;
  readonly apiName: string;
};

// r.exposesApi("a.b") — declarative announcement that this feature
// provides a handler matching the cross-feature contract `a.b`. Single
// string argument; pattern is purely declarative.
export type ExposesApiPattern = {
  readonly kind: "exposesApi";
  readonly source: SourceLocation;
  readonly apiName: string;
};

// `r.envSchema(z.object({...}))` — the env-vars contract for a feature.
// Argument is a Zod-expression (computed); we keep the source-location of
// the schema body so Designer / AI render the raw TS code (opaque).
export type EnvSchemaPattern = {
  readonly kind: "envSchema";
  readonly source: SourceLocation;
  readonly schemaBody: SourceLocation;
};

// Catch-all — r.* calls the visitor doesn't recognise. Designer renders
// "unknown call (cannot edit)", AI patcher leaves them unchanged. When
// an UnknownPattern shows up in the wild it's a signal that a new r.*
// API exists and needs its own pattern type here.
export type UnknownPattern = {
  readonly kind: "unknown";
  readonly source: SourceLocation;
  readonly methodName: string;
};

// =============================================================================
// Discriminated union — visitors return FeaturePattern[]; consumers
// switch on `kind`.
// =============================================================================

export type FeaturePattern =
  // Static
  | EntityPattern
  | RelationPattern
  | NavPattern
  | WorkspacePattern
  | ConfigPattern
  | TranslationsPattern
  | RequiresPattern
  | OptionalRequiresPattern
  | SystemScopePattern
  | ToggleablePattern
  | DescribePattern
  | MetricPattern
  | SecretPattern
  | ClaimKeyPattern
  | ReferenceDataPattern
  | ReadsConfigPattern
  | UseExtensionPattern
  | UsesApiPattern
  | ExposesApiPattern
  | TreeActionsPattern
  // Mixed
  | ScreenPattern
  | WriteHandlerPattern
  | QueryHandlerPattern
  | HookPattern
  | EntityHookPattern
  | JobPattern
  | NotificationPattern
  | AuthClaimsPattern
  | HttpRoutePattern
  | ProjectionPattern
  | MultiStreamProjectionPattern
  | DefineEventPattern
  | EventMigrationPattern
  | ExtendsRegistrarPattern
  | TreePattern
  | EnvSchemaPattern
  // Catch-all
  | UnknownPattern;

// Convenience: the literal union of all kinds, useful for Designer
// switches that exhaustively cover every pattern.
export type FeaturePatternKind = FeaturePattern["kind"];

// =============================================================================
// Editability classification — Designer UI uses this to decide whether
// to render a pattern as a form (editable) or a read-only code block
// (opaque). The AI patcher uses the same signal to decide JSON-patch
// vs TS-source-replace.
// =============================================================================

export type Editability =
  | "static" // Fully declarative — forms only, no code slot.
  | "mixed" // Header declarative + body as TS source block.
  | "opaque"; // Whole pattern is TS code, no form surface.

export function getEditability(pattern: FeaturePattern): Editability {
  switch (pattern.kind) {
    case "entity":
    case "relation":
    case "nav":
    case "workspace":
    case "config":
    case "translations":
    case "requires":
    case "optionalRequires":
    case "systemScope":
    case "toggleable":
    case "describe":
    case "metric":
    case "secret":
    case "claimKey":
    case "referenceData":
    case "readsConfig":
    case "useExtension":
    case "usesApi":
    case "exposesApi":
    case "treeActions":
      return "static";
    case "screen":
    case "writeHandler":
    case "queryHandler":
    case "hook":
    case "entityHook":
    case "job":
    case "notification":
    case "httpRoute":
    case "projection":
    case "multiStreamProjection":
    case "defineEvent":
    case "eventMigration":
      return "mixed";
    case "authClaims":
    case "extendsRegistrar":
    case "tree":
    case "envSchema":
    case "unknown":
      return "opaque";
    default: {
      // Exhaustiveness guard — adding a new pattern kind without
      // updating this switch produces a compile error here.
      const _exhaustive: never = pattern;
      return _exhaustive;
    }
  }
}
