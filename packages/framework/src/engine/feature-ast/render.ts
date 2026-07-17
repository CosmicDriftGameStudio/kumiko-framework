// Pattern → TS-Source renderer. Produces canonical Object-Form for every
// FeaturePattern kind: a single object-literal argument per r.* call.
// Output is biome-format-stable so consumers can write the file directly
// without an extra format pass.
//
// **Source-of-Truth Contract:**
//   - Static patterns (entity, nav, config, etc.) round-trip cleanly:
//     parse → render → parse yields the same patterns.
//   - Mixed patterns (writeHandler, hook, screen) embed the original
//     source-text of opaque bodies (handler/fn/closure) verbatim via
//     SourceLocation.raw — the renderer doesn't re-print closure code.
//   - Comments inside an existing pattern are NOT preserved (Designer
//     edits via forms; for AI generation the output is fresh anyway).
//
// **Schema-Version-Header:** every renderFeatureFile output starts with
// `// kumiko-feature-version: 1`. Future format bumps run a dedicated
// migrator over the version comment.

import { isRawRefSentinel } from "./extractors/shared";
import type {
  AuthClaimsPattern,
  ClaimKeyPattern,
  ConfigPattern,
  DefineEventPattern,
  DescribePattern,
  EntityPattern,
  EnvSchemaPattern,
  ExposesApiPattern,
  ExtendsRegistrarPattern,
  FeaturePattern,
  HookPattern,
  HttpRoutePattern,
  JobPattern,
  MetricPattern,
  MultiStreamProjectionPattern,
  NavPattern,
  NotificationPattern,
  OptionalRequiresPattern,
  ProjectionPattern,
  QueryHandlerPattern,
  ReadsConfigPattern,
  ReferenceDataPattern,
  RelationPattern,
  RequiresPattern,
  ScreenPattern,
  SecretPattern,
  SystemScopePattern,
  ToggleablePattern,
  TranslationsPattern,
  TreeActionsPattern,
  UiHintsPattern,
  UnknownPattern,
  UseExtensionPattern,
  UsesApiPattern,
  WorkspacePattern,
  WriteHandlerPattern,
} from "./patterns";
import { SCREEN_OPAQUE_MARKER } from "./patterns";

export const FEATURE_FILE_VERSION = 1 as const;
export const VERSION_HEADER = `// kumiko-feature-version: ${FEATURE_FILE_VERSION}`;

/**
 * Render a single FeaturePattern back to TypeScript source — a `r.<kind>(...)`
 * call in canonical Object-Form. The result is a single statement WITHOUT a
 * trailing newline; callers compose statements with their own joiner.
 */
export function renderPattern(pattern: FeaturePattern): string {
  switch (pattern.kind) {
    case "requires":
      return renderRequires(pattern);
    case "optionalRequires":
      return renderOptionalRequires(pattern);
    case "readsConfig":
      return renderReadsConfig(pattern);
    case "systemScope":
      return renderSystemScope(pattern);
    case "toggleable":
      return renderToggleable(pattern);
    case "describe":
      return renderDescribe(pattern);
    case "uiHints":
      return renderUiHints(pattern);
    case "entity":
      return renderEntity(pattern);
    case "relation":
      return renderRelation(pattern);
    case "nav":
      return renderNav(pattern);
    case "workspace":
      return renderWorkspace(pattern);
    case "config":
      return renderConfig(pattern);
    case "translations":
      return renderTranslations(pattern);
    case "metric":
      return renderMetric(pattern);
    case "secret":
      return renderSecret(pattern);
    case "claimKey":
      return renderClaimKey(pattern);
    case "referenceData":
      return renderReferenceData(pattern);
    case "useExtension":
      return renderUseExtension(pattern);
    case "screen":
      return renderScreen(pattern);
    case "writeHandler":
      return renderWriteHandler(pattern);
    case "queryHandler":
      return renderQueryHandler(pattern);
    case "hook":
      return renderHook(pattern);
    case "job":
      return renderJob(pattern);
    case "notification":
      return renderNotification(pattern);
    case "authClaims":
      return renderAuthClaims(pattern);
    case "httpRoute":
      return renderHttpRoute(pattern);
    case "projection":
      return renderProjection(pattern);
    case "multiStreamProjection":
      return renderMultiStreamProjection(pattern);
    case "defineEvent":
      return renderDefineEvent(pattern);
    case "extendsRegistrar":
      return renderExtendsRegistrar(pattern);
    case "usesApi":
      return renderUsesApi(pattern);
    case "exposesApi":
      return renderExposesApi(pattern);
    case "treeActions":
      return renderTreeActions(pattern);
    case "envSchema":
      return renderEnvSchema(pattern);
    case "unknown":
      return renderUnknown(pattern);
    default: {
      const _exhaustive: never = pattern;
      return _exhaustive;
    }
  }
}

// =============================================================================
// JSON-Like Value Renderer — emits TypeScript-source-compatible literals.
// Used for declarative pattern bodies (entity definitions, config keys, etc.).
// =============================================================================

/**
 * Threshold above which a single-line array/object renders multi-line.
 * Biome's default print-width is 100 columns; we leave a margin so a
 * pattern at indent=4 still fits before wrapping. Short arrays/objects
 * stay on one line, long ones go multi-line — biome-stable in both.
 */
const SINGLE_LINE_WIDTH = 80;

/**
 * Render a JSON-compatible value as TypeScript source. Matches what
 * `readDataLiteralNode` accepts on the parser side: strings, numbers,
 * booleans, null, arrays, plain objects. Unsupported values (functions,
 * undefined) throw — they should never reach here for a static pattern.
 *
 * Keys are quoted only when they are not valid JS identifiers. The
 * renderer prefers single-line output for short arrays/objects (≤80
 * chars including indent and no nested newlines) and falls back to
 * multi-line otherwise — biome-stable in both branches.
 */
export function renderValue(value: unknown, indent = 0): string {
  if (isRawRefSentinel(value)) return value.__raw;
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => renderValue(v, indent + 2));
    const singleLine = `[${items.join(", ")}]`;
    if (singleLine.length + indent <= SINGLE_LINE_WIDTH && !singleLine.includes("\n")) {
      return singleLine;
    }
    const inner = items.map((item) => `${spaces(indent + 2)}${item}`).join(",\n");
    return `[\n${inner},\n${spaces(indent)}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const items = entries.map(([k, v]) => `${renderKey(k)}: ${renderValue(v, indent + 2)}`);
    const singleLine = `{ ${items.join(", ")} }`;
    if (singleLine.length + indent <= SINGLE_LINE_WIDTH && !singleLine.includes("\n")) {
      return singleLine;
    }
    const inner = items.map((item) => `${spaces(indent + 2)}${item}`).join(",\n");
    return `{\n${inner},\n${spaces(indent)}}`;
  }
  throw new Error(`renderValue: unsupported type for value ${String(value)}`);
}

const VALID_IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function renderKey(key: string): string {
  return VALID_IDENT.test(key) ? key : JSON.stringify(key);
}

function spaces(n: number): string {
  return " ".repeat(n);
}

// =============================================================================
// Static patterns
// =============================================================================

function renderRequires(p: RequiresPattern): string {
  return `r.requires({ features: ${renderValue([...p.featureNames])} });`;
}

function renderOptionalRequires(p: OptionalRequiresPattern): string {
  return `r.optionalRequires({ features: ${renderValue([...p.featureNames])} });`;
}

function renderReadsConfig(p: ReadsConfigPattern): string {
  return `r.readsConfig({ keys: ${renderValue([...p.qualifiedKeys])} });`;
}

function renderSystemScope(_p: SystemScopePattern): string {
  return "r.systemScope();";
}

function renderToggleable(p: ToggleablePattern): string {
  return `r.toggleable({ default: ${p.default} });`;
}

function renderDescribe(p: DescribePattern): string {
  return `r.describe(${JSON.stringify(p.text)});`;
}

function renderEntity(p: EntityPattern): string {
  // A whole-value raw-ref (`r.entity("x", eventEntity)`) can't be spread
  // into the merged Object-Form without losing `name` to the sentinel
  // shortcut in renderValue — fall back to the classic positional form,
  // which keeps the reference verbatim alongside the name.
  if (isRawRefSentinel(p.definition)) {
    return `r.entity(${JSON.stringify(p.entityName)}, ${p.definition.__raw});`;
  }
  // Inline `name` into the definition object — canonical Object-Form
  // is a single arg with name-as-property.
  const merged = { name: p.entityName, ...p.definition };
  return `r.entity(${renderValue(merged)});`;
}

function renderRelation(p: RelationPattern): string {
  if (isRawRefSentinel(p.definition)) {
    return `r.relation(${JSON.stringify(p.entityName)}, ${JSON.stringify(p.relationName)}, ${p.definition.__raw});`;
  }
  const merged = { entity: p.entityName, name: p.relationName, ...p.definition };
  return `r.relation(${renderValue(merged)});`;
}

function renderNav(p: NavPattern): string {
  return `r.nav(${renderValue(p.definition)});`;
}

function renderWorkspace(p: WorkspacePattern): string {
  return `r.workspace(${renderValue(p.definition)});`;
}

function renderConfig(p: ConfigPattern): string {
  return `r.config(${renderValue({ keys: p.keys })});`;
}

function renderTranslations(p: TranslationsPattern): string {
  return `r.translations(${renderValue({ keys: p.keys })});`;
}

function renderMetric(p: MetricPattern): string {
  if (isRawRefSentinel(p.options)) {
    return `r.metric(${JSON.stringify(p.shortName)}, ${p.options.__raw});`;
  }
  const merged = { name: p.shortName, ...p.options };
  return `r.metric(${renderValue(merged)});`;
}

function renderSecret(p: SecretPattern): string {
  if (isRawRefSentinel(p.options)) {
    return `r.secret(${JSON.stringify(p.shortName)}, ${p.options.__raw});`;
  }
  const merged = { name: p.shortName, ...p.options };
  return `r.secret(${renderValue(merged)});`;
}

function renderClaimKey(p: ClaimKeyPattern): string {
  return `r.claimKey(${renderValue({ name: p.shortName, type: p.claimType })});`;
}

function renderReferenceData(p: ReferenceDataPattern): string {
  const merged: Record<string, unknown> = {
    entity: p.entityName,
    data: [...p.data],
    ...(p.upsertKey !== undefined && { upsertKey: p.upsertKey }),
  };
  return `r.referenceData(${renderValue(merged)});`;
}

function renderUseExtension(p: UseExtensionPattern): string {
  if (isRawRefSentinel(p.options)) {
    return `r.useExtension(${JSON.stringify(p.extensionName)}, ${JSON.stringify(p.entityName)}, ${p.options.__raw});`;
  }
  const merged: Record<string, unknown> = {
    name: p.extensionName,
    entity: p.entityName,
    ...(p.options ?? {}),
  };
  return `r.useExtension(${renderValue(merged)});`;
}

// =============================================================================
// Mixed patterns — header is data, body is opaque source-span (raw TS).
//
// We embed `SourceLocation.raw` verbatim. The static parts get rendered
// as JSON-like values; the closure / schema / template body slots in as
// the original text. Indentation matters for biome-stability — opaque
// bodies are placed at the property's indent level.
// =============================================================================

function renderScreen(p: ScreenPattern): string {
  // ScreenDefinition may carry $opaque markers where closures lived.
  // We swap each marker for the raw source span from opaqueProps. Walking
  // the definition by JSON-path matches how the parser keys the spans.
  const woven = weaveOpaque(p.definition, p.opaqueProps, "");
  return `r.screen(${renderValueWithRawSlots(woven, 0)});`;
}

/**
 * Re-indent a multi-line opaque source span so its continuation lines
 * align with the new context. The body's first line is left as-is (it's
 * inserted right after `: ` in the property assignment); follow-up
 * lines have their *minimum leading whitespace* stripped, then the new
 * indent prepended. Single-line bodies pass through.
 *
 * Why: bodies are captured verbatim from the original file at whatever
 * indent they sat at. When embedded into a different surrounding
 * structure (e.g. positional → object form), the relative indent
 * shifts. Without this normalisation the rendered output looks ragged
 * and the roundtrip equality test sees `raw` strings that differ in
 * whitespace, even though the code is identical.
 */
function reindentBody(raw: string, newIndent: string): string {
  const lines = raw.split("\n");
  if (lines.length <= 1) return raw;
  // Determine the smallest leading-whitespace of non-empty continuation lines.
  let minIndent = Infinity;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (line.trim() === "") continue;
    const lead = line.match(/^[ \t]*/)?.[0].length ?? 0;
    if (lead < minIndent) minIndent = lead;
  }
  if (!Number.isFinite(minIndent)) return raw;
  const out = [lines[0] ?? ""];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      out.push("");
    } else {
      out.push(newIndent + line.slice(minIndent));
    }
  }
  return out.join("\n");
}

function renderWriteHandler(p: WriteHandlerPattern): string {
  if (p.handlerName === undefined) return p.source.raw;
  const lines: string[] = ["r.writeHandler({"];
  lines.push(`  name: ${JSON.stringify(p.handlerName)},`);
  lines.push(`  schema: ${reindentBody(p.schemaSource?.raw ?? "", PATTERN_INDENT)},`);
  lines.push(`  handler: ${reindentBody(p.handlerBody?.raw ?? "", PATTERN_INDENT)},`);
  if (p.access !== undefined) lines.push(`  access: ${renderValue(p.access)},`);
  if (p.rateLimit !== undefined) lines.push(`  rateLimit: ${renderValue(p.rateLimit)},`);
  if (p.unsafeSkipTransitionGuard === true) lines.push("  unsafeSkipTransitionGuard: true,");
  lines.push("});");
  return lines.join("\n");
}

function renderQueryHandler(p: QueryHandlerPattern): string {
  if (p.handlerName === undefined) return p.source.raw;
  const lines: string[] = ["r.queryHandler({"];
  lines.push(`  name: ${JSON.stringify(p.handlerName)},`);
  lines.push(`  schema: ${reindentBody(p.schemaSource?.raw ?? "", PATTERN_INDENT)},`);
  lines.push(`  handler: ${reindentBody(p.handlerBody?.raw ?? "", PATTERN_INDENT)},`);
  if (p.access !== undefined) lines.push(`  access: ${renderValue(p.access)},`);
  if (p.rateLimit !== undefined) lines.push(`  rateLimit: ${renderValue(p.rateLimit)},`);
  lines.push("});");
  return lines.join("\n");
}

function renderHookTarget(target: HookPattern["target"]): string {
  if (typeof target === "string") return renderValue(target);
  if ("allOf" in target) return `{ allOf: ${JSON.stringify(target.allOf)} }`;
  return renderValue([...target]);
}

function renderHook(p: HookPattern): string {
  const lines: string[] = ["r.hook({"];
  lines.push(`  type: ${JSON.stringify(p.hookType)},`);
  lines.push(`  target: ${renderHookTarget(p.target)},`);
  lines.push(`  handler: ${reindentBody(p.fnBody.raw, PATTERN_INDENT)},`);
  if (p.phase !== undefined) lines.push(`  phase: ${JSON.stringify(p.phase)},`);
  lines.push("});");
  return lines.join("\n");
}

function renderJob(p: JobPattern): string {
  const lines: string[] = ["r.job({"];
  lines.push(`  name: ${JSON.stringify(p.jobName)},`);
  for (const [k, v] of Object.entries(p.options)) {
    lines.push(`  ${renderKey(k)}: ${renderValue(v)},`);
  }
  lines.push(`  handler: ${p.handlerBody.raw},`);
  lines.push("});");
  return lines.join("\n");
}

function renderNotification(p: NotificationPattern): string {
  const lines: string[] = ["r.notification({"];
  lines.push(`  name: ${JSON.stringify(p.notificationName)},`);
  lines.push(`  trigger: { on: ${JSON.stringify(p.trigger.on)} },`);
  lines.push(`  recipient: ${p.recipientBody.raw},`);
  lines.push(`  data: ${p.dataBody.raw},`);
  if (p.templates && Object.keys(p.templates).length > 0) {
    lines.push("  templates: {");
    for (const [k, loc] of Object.entries(p.templates)) {
      lines.push(`    ${renderKey(k)}: ${loc.raw},`);
    }
    lines.push("  },");
  }
  lines.push("});");
  return lines.join("\n");
}

function renderAuthClaims(p: AuthClaimsPattern): string {
  return `r.authClaims(${p.fnBody.raw});`;
}

// treeActions is a static object-literal (mirrors renderWorkspace).
function renderTreeActions(p: TreeActionsPattern): string {
  return `r.treeActions(${renderValue(p.definitions)});`;
}

function renderHttpRoute(p: HttpRoutePattern): string {
  const lines: string[] = ["r.httpRoute({"];
  lines.push(`  method: ${JSON.stringify(p.method)},`);
  lines.push(`  path: ${JSON.stringify(p.path)},`);
  if (p.anonymous === true) lines.push("  anonymous: true,");
  lines.push(`  handler: ${p.handlerBody.raw},`);
  lines.push("});");
  return lines.join("\n");
}

function renderProjection(p: ProjectionPattern): string {
  const lines: string[] = ["r.projection({"];
  lines.push(`  name: ${JSON.stringify(p.name)},`);
  // ProjectionPattern.sourceEntity is the typed field; the runtime
  // r.projection({...}) call uses `source` (matches ProjectionDefinition).
  lines.push(
    `  source: ${renderValue(typeof p.sourceEntity === "string" ? p.sourceEntity : [...p.sourceEntity])},`,
  );
  lines.push("  apply: {");
  for (const [eventType, loc] of Object.entries(p.applyBodies)) {
    lines.push(`    ${renderKey(eventType)}: ${loc.raw},`);
  }
  lines.push("  },");
  lines.push("});");
  return lines.join("\n");
}

function renderMultiStreamProjection(p: MultiStreamProjectionPattern): string {
  const lines: string[] = ["r.multiStreamProjection({"];
  lines.push(`  name: ${JSON.stringify(p.name)},`);
  lines.push("  apply: {");
  for (const [eventType, loc] of Object.entries(p.applyBodies)) {
    lines.push(`    ${renderKey(eventType)}: ${loc.raw},`);
  }
  lines.push("  },");
  if (p.errorMode !== undefined) lines.push(`  errorMode: ${renderValue(p.errorMode)},`);
  if (p.runIn !== undefined) lines.push(`  runIn: ${renderValue(p.runIn)},`);
  if (p.delivery !== undefined) lines.push(`  delivery: ${JSON.stringify(p.delivery)},`);
  lines.push("});");
  return lines.join("\n");
}

function renderDefineEvent(p: DefineEventPattern): string {
  const lines: string[] = ["r.defineEvent({"];
  lines.push(`  name: ${JSON.stringify(p.eventName)},`);
  lines.push(`  schema: ${p.schemaSource.raw},`);
  if (p.version !== undefined) lines.push(`  version: ${p.version},`);
  if (p.migrations !== undefined) {
    const entries = Object.entries(p.migrations);
    if (entries.length > 0) {
      lines.push("  migrations: {");
      for (const [fromVersion, transformBody] of entries) {
        lines.push(`    "${fromVersion}": ${transformBody.raw},`);
      }
      lines.push("  },");
    }
  }
  lines.push("});");
  return lines.join("\n");
}

function renderExtendsRegistrar(p: ExtendsRegistrarPattern): string {
  return `r.extendsRegistrar(${JSON.stringify(p.extensionName)}, ${p.defBody.raw});`;
}

function renderEnvSchema(p: EnvSchemaPattern): string {
  return `r.envSchema(${p.schemaBody.raw});`;
}

function renderUsesApi(p: UsesApiPattern): string {
  return `r.usesApi(${JSON.stringify(p.apiName)});`;
}

function renderExposesApi(p: ExposesApiPattern): string {
  return `r.exposesApi(${JSON.stringify(p.apiName)});`;
}

function renderUiHints(p: UiHintsPattern): string {
  return p.source.raw;
}

function renderUnknown(p: UnknownPattern): string {
  // Round-trip preservation only: emit the raw call text from the
  // SourceLocation so the rendered file stays semantically identical
  // to the input.
  //
  // **Patch-Surprise warning:** an UnknownPattern cannot be added via
  // FeaturePatcher (no typed `addUnknown` exists, by design — typed
  // adds force the caller to commit to a known pattern-kind). It also
  // cannot be replaced/removed cleanly, because no PatternId variant
  // matches an UnknownPattern's free-form shape. Treat UnknownPattern
  // as read-only in the patcher pipeline; the only way to "edit" one
  // is to convert it to a known pattern-kind first (i.e. add a typed
  // extractor + pattern type).
  return p.source.raw;
}

// =============================================================================
// Screen-Pattern body weaving — replaces $opaque markers with raw spans.
// =============================================================================

type WovenValue = unknown | { readonly __raw: string };

function weaveOpaque(
  value: unknown,
  opaqueProps: Readonly<Record<string, { readonly raw: string }>>,
  path: string,
): WovenValue {
  if (value === SCREEN_OPAQUE_MARKER) {
    const span = opaqueProps[path];
    if (!span) throw new Error(`weaveOpaque: missing span for path "${path}"`);
    return { __raw: span.raw };
  }
  if (Array.isArray(value)) {
    return value.map((el, idx) => weaveOpaque(el, opaqueProps, `${path}.${idx}`));
  }
  if (value && typeof value === "object") {
    const out: Record<string, WovenValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${k}` : k;
      out[k] = weaveOpaque(v, opaqueProps, childPath);
    }
    return out;
  }
  return value;
}

function renderValueWithRawSlots(value: WovenValue, indent: number): string {
  if (isRawRefSentinel(value)) return value.__raw;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const inner = value
      .map((v) => `${spaces(indent + 2)}${renderValueWithRawSlots(v, indent + 2)}`)
      .join(",\n");
    return `[\n${inner},\n${spaces(indent)}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, WovenValue>);
    if (entries.length === 0) return "{}";
    const inner = entries
      .map(
        ([k, v]) =>
          `${spaces(indent + 2)}${renderKey(k)}: ${renderValueWithRawSlots(v, indent + 2)}`,
      )
      .join(",\n");
    return `{\n${inner},\n${spaces(indent)}}`;
  }
  return renderValue(value, indent);
}

// =============================================================================
// Feature-File rendering
// =============================================================================

export type RenderFeatureFileInput = {
  readonly featureName: string;
  readonly patterns: readonly FeaturePattern[];
  /** Extra import lines emitted between the version header and defineFeature.
   *  Defaults to the minimum: defineFeature + zod. */
  readonly imports?: readonly string[];
};

const DEFAULT_IMPORTS = [
  'import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";',
  'import { z } from "zod";',
] as const;

/**
 * Render a complete feature-file: schema-version header, imports, the
 * defineFeature call wrapping every pattern in source order. The output
 * is biome-format-stable so callers can persist it directly.
 */
export function renderFeatureFile(input: RenderFeatureFileInput): string {
  const imports = input.imports ?? DEFAULT_IMPORTS;
  const body = input.patterns.map((p) => indent(renderPattern(p), PATTERN_INDENT)).join("\n\n");
  return [
    VERSION_HEADER,
    "",
    ...imports,
    "",
    `defineFeature(${JSON.stringify(input.featureName)}, (r) => {`,
    body,
    "});",
    "",
  ].join("\n");
}

/**
 * Prefix every non-empty line of `text` with `prefix`. Re-used from the
 * patcher (patch.ts imports this) so indent helpers stay in one place
 * — when canonical-form indentation conventions ever change, only this
 * function needs to follow.
 */
export function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? line : prefix + line))
    .join("\n");
}

/**
 * Indentation prefix used inside `defineFeature((r) => { ... })` for
 * every top-level r.* statement. Two-space convention matches biome's
 * default and the parse-happy-path test fixture.
 */
export const PATTERN_INDENT = "  ";
