// FeaturePattern — typed representation of an `r.*` call inside a
// feature file. The AST visitor (parse.ts) walks the
// `defineFeature(name, (r) => { ... })` setup callback and yields one
// FeaturePattern per recognised call.
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

export type EntityPattern = {
  readonly kind: "entity";
  readonly source: SourceLocation;
  readonly entityName: string;
  readonly definition: EntityDefinition;
};

export type RelationPattern = {
  readonly kind: "relation";
  readonly source: SourceLocation;
  readonly entityName: string;
  readonly relationName: string;
  readonly definition: RelationDefinition;
};

export type NavPattern = {
  readonly kind: "nav";
  readonly source: SourceLocation;
  readonly definition: NavDefinition;
};

export type WorkspacePattern = {
  readonly kind: "workspace";
  readonly source: SourceLocation;
  readonly definition: WorkspaceDefinition;
};

export type ConfigPattern = {
  readonly kind: "config";
  readonly source: SourceLocation;
  readonly keys: Readonly<Record<string, ConfigKeyDefinition<ConfigKeyType>>>;
};

export type TranslationsPattern = {
  readonly kind: "translations";
  readonly source: SourceLocation;
  readonly keys: TranslationKeys;
};

export type RequiresPattern = {
  readonly kind: "requires";
  readonly source: SourceLocation;
  readonly featureNames: readonly string[];
};

export type OptionalRequiresPattern = {
  readonly kind: "optionalRequires";
  readonly source: SourceLocation;
  readonly featureNames: readonly string[];
};

export type SystemScopePattern = {
  readonly kind: "systemScope";
  readonly source: SourceLocation;
};

export type ToggleablePattern = {
  readonly kind: "toggleable";
  readonly source: SourceLocation;
  readonly default: boolean;
};

export type MetricPattern = {
  readonly kind: "metric";
  readonly source: SourceLocation;
  readonly shortName: string;
  readonly options: MetricOptions;
};

export type SecretPattern = {
  readonly kind: "secret";
  readonly source: SourceLocation;
  readonly shortName: string;
  readonly options: SecretOptions;
};

export type ClaimKeyPattern = {
  readonly kind: "claimKey";
  readonly source: SourceLocation;
  readonly shortName: string;
  readonly claimType: ClaimKeyType;
};

export type ReferenceDataPattern = {
  readonly kind: "referenceData";
  readonly source: SourceLocation;
  readonly entityName: string;
  readonly data: ReferenceDataDef["data"];
  readonly upsertKey?: string;
};

export type ReadsConfigPattern = {
  readonly kind: "readsConfig";
  readonly source: SourceLocation;
  readonly qualifiedKeys: readonly string[];
};

export type UseExtensionPattern = {
  readonly kind: "useExtension";
  readonly source: SourceLocation;
  readonly extensionName: string;
  readonly entityName: string;
  readonly options?: Readonly<Record<string, unknown>>;
};

// r.treeActions({ ... }) — Schema-Map für Visual-Tree-Action-Verben.
// Static: Args sind Type-Samples (kein Runtime-Validator), Designer
// rendert das als nested form pro Action. Compile-Time-Validation
// passiert via setup-export-Handle (TreeActionsHandle), nicht über
// dieses Pattern — das hier ist reine Runtime-Repräsentation.
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

export type ScreenPattern = {
  readonly kind: "screen";
  readonly source: SourceLocation;
  readonly definition: ScreenDefinition;
  // Closure-typed sub-properties (FieldCondition, RowAction.payload,
  // FieldRenderer function form). Keyed by JSON path inside the
  // definition (e.g. "rowActions.0.visible", "fields.email.renderer").
  readonly opaqueProps: OpaquePropMap;
};

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
  readonly skipTransitionGuard?: boolean;
};

export type QueryHandlerPattern = {
  readonly kind: "queryHandler";
  readonly source: SourceLocation;
  readonly handlerName: string;
  readonly schemaSource: SourceLocation;
  readonly handlerBody: SourceLocation;
  readonly access?: AccessRule;
  readonly rateLimit?: RateLimitOption;
};

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

export type EntityHookPattern = {
  readonly kind: "entityHook";
  readonly source: SourceLocation;
  readonly hookType: "postSave" | "preDelete" | "postDelete";
  readonly entityName: string;
  readonly fnBody: SourceLocation;
  readonly phase?: HookPhase;
};

export type JobPattern = {
  readonly kind: "job";
  readonly source: SourceLocation;
  readonly jobName: string;
  // JobDefinition without `name` (already on jobName) and without
  // `handler` (kept separately as handlerBody for opacity).
  readonly options: Omit<JobDefinition, "name" | "handler">;
  readonly handlerBody: SourceLocation;
};

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

export type AuthClaimsPattern = {
  readonly kind: "authClaims";
  readonly source: SourceLocation;
  readonly fnBody: SourceLocation;
};

// r.tree(provider) — Top-Level-Tree-Provider-Function. Closure-only,
// kein Header-Form. Designer rendert als read-only Code-Block, AI-
// Patcher überschreibt span verbatim. Konsistent mit r.authClaims —
// auch da ist die Function-Body die einzige Information.
export type TreePattern = {
  readonly kind: "tree";
  readonly source: SourceLocation;
  readonly providerBody: SourceLocation;
};

export type HttpRoutePattern = {
  readonly kind: "httpRoute";
  readonly source: SourceLocation;
  readonly method: HttpRouteMethod;
  readonly path: string;
  readonly anonymous?: boolean;
  readonly handlerBody: SourceLocation;
};

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

export type MultiStreamProjectionPattern = {
  readonly kind: "multiStreamProjection";
  readonly source: SourceLocation;
  readonly name: string;
  readonly applyBodies: Readonly<Record<string, SourceLocation>>;
  readonly errorMode?: MspErrorMode;
  readonly runIn?: RunIn;
  readonly delivery?: "shared" | "per-instance";
};

export type DefineEventPattern = {
  readonly kind: "defineEvent";
  readonly source: SourceLocation;
  readonly eventName: string;
  readonly schemaSource: SourceLocation;
  readonly version?: number;
};

export type EventMigrationPattern = {
  readonly kind: "eventMigration";
  readonly source: SourceLocation;
  readonly eventName: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly transformBody: SourceLocation;
};

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

// =============================================================================
// Catch-all — r.* calls the visitor doesn't recognise. Designer renders
// "unknown call (cannot edit)", AI patcher leaves them unchanged. When
// an UnknownPattern shows up in the wild it's a signal that a new r.*
// API exists and needs its own pattern type here.
// =============================================================================

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
