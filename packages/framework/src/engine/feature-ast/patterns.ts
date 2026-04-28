// FeaturePattern — typisierte Repräsentation eines `r.*`-Calls in einem
// Feature-File. Der AST-Visitor (parse.ts) walked durch das
// `defineFeature(name, (r) => { ... })`-Setup-Callback und produziert
// pro erkanntem Call ein FeaturePattern.
//
// **Design-Prinzip:**
//
//   - Alles was Designer/AI deklarativ editieren können → static-fields
//     pro Pattern (z.B. EntityPattern.definition als plain Daten).
//   - Alles was Closures/Code enthält → SourceLocation auf die opaque
//     Region. Designer rendert das als read-only Code-Block, AI-Patcher
//     kann den Bereich gezielt überschreiben.
//
// **Coverage:** 100%. Was wir NICHT als Pattern erkennen, fällt durch
// `UnknownPattern` und behält source — Designer zeigt "unbekannter
// r.*-Call", AI lässt es in Ruhe. Custom-TypeScript-Code zwischen
// `r.*`-Calls (Helper-Funktionen, lokale Konstanten, imports) wird
// vom Visitor *nicht* extrahiert — er bleibt im File-Buffer und
// überlebt jeden Patch unverändert.
//
// **Erweiterung:** neue r.*-API → neuer Pattern-Type hier hinzufügen +
// Visitor lernt das neue Token. Die Discriminated Union zwingt den
// Visitor (und alle Konsumenten — Designer, AI-Patcher) sich auf den
// neuen Kind zu committen, sonst Compile-Error.

import type { SourceLocation } from "./source-location";

// =============================================================================
// Static Patterns — vollständig deklarativ, Designer rendert Forms,
// AI generiert sie als pure JSON. Round-Trip ohne Code-Spans.
// =============================================================================

export type EntityPattern = {
  readonly kind: "entity";
  readonly source: SourceLocation;
  readonly entityName: string;
  // EntityDefinition ist JSON-safe (Whitelist in buildAppSchema beweist
  // das schon). Function-Defaults / Computed-Fields sind hier opaque und
  // werden als raw-string in der Field-Definition gehalten.
  readonly definition: Record<string, unknown>;
};

export type RelationPattern = {
  readonly kind: "relation";
  readonly source: SourceLocation;
  readonly entityName: string;
  readonly relationName: string;
  readonly definition: Record<string, unknown>;
};

export type NavPattern = {
  readonly kind: "nav";
  readonly source: SourceLocation;
  readonly definition: Record<string, unknown>;
};

export type WorkspacePattern = {
  readonly kind: "workspace";
  readonly source: SourceLocation;
  readonly definition: Record<string, unknown>;
};

export type ConfigPattern = {
  readonly kind: "config";
  readonly source: SourceLocation;
  // Map shortName → ConfigKeyDefinition, alles Daten
  readonly keys: Record<string, unknown>;
};

export type TranslationsPattern = {
  readonly kind: "translations";
  readonly source: SourceLocation;
  // Nested Locale-Tree, plain JSON
  readonly keys: Record<string, unknown>;
};

export type RequiresPattern = {
  readonly kind: "requires";
  readonly source: SourceLocation;
  readonly featureNames: readonly string[];
};

export type OptionalRequiresPattern = {
  readonly kind: "optional-requires";
  readonly source: SourceLocation;
  readonly featureNames: readonly string[];
};

export type SystemScopePattern = {
  readonly kind: "system-scope";
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
  readonly options: Record<string, unknown>;
};

export type SecretPattern = {
  readonly kind: "secret";
  readonly source: SourceLocation;
  readonly shortName: string;
  readonly options: Record<string, unknown>;
};

export type ClaimKeyPattern = {
  readonly kind: "claim-key";
  readonly source: SourceLocation;
  readonly shortName: string;
  readonly options: Record<string, unknown>;
};

export type ReferenceDataPattern = {
  readonly kind: "reference-data";
  readonly source: SourceLocation;
  readonly entityName: string;
  readonly data: readonly Record<string, unknown>[];
  readonly upsertKey?: string;
};

export type ReadsConfigPattern = {
  readonly kind: "reads-config";
  readonly source: SourceLocation;
  readonly qualifiedKeys: readonly string[];
};

export type UseExtensionPattern = {
  readonly kind: "use-extension";
  readonly source: SourceLocation;
  readonly extensionName: string;
  readonly entityName: string;
  readonly options?: Record<string, unknown>;
};

// =============================================================================
// Mixed Patterns — Header (name/schema-shape/access) ist deklarativ,
// Body (handler-fn / hook-fn / apply-fn / transform-fn) ist opaque.
// Designer rendert den Header als Form + den Body als Code-Block.
// AI-Patcher generiert Header als Daten + Body als TypeScript-Source.
// =============================================================================

export type ScreenPattern = {
  readonly kind: "screen";
  readonly source: SourceLocation;
  // Layout-/Column-Daten sind static. Function-Props (FieldCondition,
  // RowAction.payload, FieldRenderer-Function-Form) liegen als
  // SourceLocation in `opaqueProps` — Designer rendert sie als
  // read-only Code-Excerpts, AI weiß dass es dort patchen darf.
  readonly definition: Record<string, unknown>;
  readonly opaqueProps: readonly SourceLocation[];
};

export type WriteHandlerPattern = {
  readonly kind: "write-handler";
  readonly source: SourceLocation;
  readonly handlerName: string;
  // schemaSource: Zod-Aufruf als Source-Text (z.B. "z.object({...})").
  // Round-Trip via Re-Eval bei Patch — wir parsen Zod nicht zurück nach
  // JSON-Schema (zu fragil), wir behandeln es als opaken Block.
  readonly schemaSource: SourceLocation;
  // handlerBody: Closure-Body als Source-Text. Opaque — AI generiert
  // TS-Code, kein deklaratives DSL.
  readonly handlerBody: SourceLocation;
  readonly access?: Record<string, unknown>;
  readonly rateLimit?: Record<string, unknown>;
  readonly skipTransitionGuard?: boolean;
};

export type QueryHandlerPattern = {
  readonly kind: "query-handler";
  readonly source: SourceLocation;
  readonly handlerName: string;
  readonly schemaSource: SourceLocation;
  readonly handlerBody: SourceLocation;
  readonly access?: Record<string, unknown>;
  readonly rateLimit?: Record<string, unknown>;
};

export type HookPattern = {
  readonly kind: "hook";
  readonly source: SourceLocation;
  // type: "preSave" | "postSave" | "preDelete" | "postDelete" | "preQuery" | "validation"
  readonly hookType: string;
  readonly target: string | readonly string[];
  readonly fnBody: SourceLocation;
  readonly phase?: string;
};

export type EntityHookPattern = {
  readonly kind: "entity-hook";
  readonly source: SourceLocation;
  readonly hookType: string;
  readonly entityName: string;
  readonly fnBody: SourceLocation;
  readonly phase?: string;
};

export type JobPattern = {
  readonly kind: "job";
  readonly source: SourceLocation;
  readonly jobName: string;
  readonly options: Record<string, unknown>;
  readonly handlerBody: SourceLocation;
};

export type NotificationPattern = {
  readonly kind: "notification";
  readonly source: SourceLocation;
  readonly notificationName: string;
  readonly trigger: Record<string, unknown>;
  readonly recipientBody: SourceLocation;
  readonly dataBody: SourceLocation;
  readonly templates?: Record<string, SourceLocation>;
};

export type AuthClaimsPattern = {
  readonly kind: "auth-claims";
  readonly source: SourceLocation;
  readonly fnBody: SourceLocation;
};

export type HttpRoutePattern = {
  readonly kind: "http-route";
  readonly source: SourceLocation;
  readonly method: string;
  readonly path: string;
  readonly anonymous?: boolean;
  readonly handlerBody: SourceLocation;
};

export type ProjectionPattern = {
  readonly kind: "projection";
  readonly source: SourceLocation;
  readonly name: string;
  // Entity-Name(s) deren Events diese Projection feedet. Kein Konflikt
  // mit `source: SourceLocation` weil bewusst andere Bedeutung.
  readonly sourceEntity: string | readonly string[];
  // applyBodies: Map event-type → SourceLocation der apply-Closure
  readonly applyBodies: Record<string, SourceLocation>;
};

export type MultiStreamProjectionPattern = {
  readonly kind: "multi-stream-projection";
  readonly source: SourceLocation;
  readonly name: string;
  readonly applyBodies: Record<string, SourceLocation>;
  readonly errorMode?: Record<string, unknown>;
  readonly runIn?: string;
  readonly delivery?: string;
};

export type DefineEventPattern = {
  readonly kind: "define-event";
  readonly source: SourceLocation;
  readonly eventName: string;
  readonly schemaSource: SourceLocation;
  readonly version?: number;
};

export type EventMigrationPattern = {
  readonly kind: "event-migration";
  readonly source: SourceLocation;
  readonly eventName: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly transformBody: SourceLocation;
};

export type ExtendsRegistrarPattern = {
  readonly kind: "extends-registrar";
  readonly source: SourceLocation;
  readonly extensionName: string;
  // Meta-programming — alles als opaque behandeln im MVP. Designer
  // zeigt nur "Custom Registrar Extension", AI lässt es in Ruhe.
  readonly defBody: SourceLocation;
};

// =============================================================================
// Catch-all für r.*-Calls die der Visitor nicht kennt. Designer rendert
// sie als "Unbekannter Call (kann nicht editiert werden)", AI-Patcher
// lässt sie in Ruhe. Wenn ein UnknownPattern in der Wildnis auftaucht
// → wahrscheinlich neuer r.*-API, neuen Pattern-Type definieren.
// =============================================================================

export type UnknownPattern = {
  readonly kind: "unknown";
  readonly source: SourceLocation;
  readonly methodName: string;
};

// =============================================================================
// Discriminated Union — der Visitor returnt FeaturePattern[],
// Konsumenten (Designer, AI-Patcher) switchen auf `kind`.
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
  // Catch-all
  | UnknownPattern;

// =============================================================================
// Editability-Klassifikation — Designer-UI braucht das um zu entscheiden,
// ob ein Pattern als Form (editable) oder als read-only Code-Block
// (opaque) gerendert wird. AI-Patcher nutzt das gleiche Signal um zu
// entscheiden, ob das Pattern als JSON oder als TS-Source patchbar ist.
// =============================================================================

export type Editability =
  | "static"   // Vollständig deklarativ — Forms only, kein Code-Slot
  | "mixed"    // Header deklarativ + Body als TS-Source-Block
  | "opaque";  // Komplett TS-Code, kein Form-Anteil

export function getEditability(pattern: FeaturePattern): Editability {
  switch (pattern.kind) {
    case "entity":
    case "relation":
    case "nav":
    case "workspace":
    case "config":
    case "translations":
    case "requires":
    case "optional-requires":
    case "system-scope":
    case "toggleable":
    case "metric":
    case "secret":
    case "claim-key":
    case "reference-data":
    case "reads-config":
    case "use-extension":
      return "static";
    case "screen":
    case "write-handler":
    case "query-handler":
    case "hook":
    case "entity-hook":
    case "job":
    case "notification":
    case "http-route":
    case "projection":
    case "multi-stream-projection":
    case "define-event":
    case "event-migration":
      return "mixed";
    case "auth-claims":
    case "extends-registrar":
    case "unknown":
      return "opaque";
  }
}
