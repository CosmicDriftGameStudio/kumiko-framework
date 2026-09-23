// Runtime validator for the `unknown → PatternChange[]` boundary. An AI
// tool (or any external caller) hands us JSON; before it ever reaches
// `applyChanges` it must pass through here. Every rejection carries an
// exact dotted/bracketed path so the caller (frequently an LLM) can
// self-correct without a human in the loop — see kumiko-framework#3137.
//
// **Zod v4 constraint driving this file's shape:** every discriminated-
// union member below stays a plain `z.object(...)` (or `.superRefine`
// wrapper around one) — never `.transform()` at the object level. A
// whole-object transform would erase the "which member matched" signal
// `discriminatedUnion` needs to attribute a nested field error to the
// right member, and it would blur per-member `.strict()` unrecognized-key
// detection. Transforms only ever touch a single field (`sourceBody`,
// below) — never the object they live on.
//
// **Deep definitions stay opaque.** EntityDefinition, ScreenDefinition,
// NavDefinition, WorkspaceDefinition, JobDefinition-options, MetricOptions,
// etc. are NOT hand-modeled here — that would fork a second, driftable
// catalogue of their shape. They're accepted via `z.custom` (plain object,
// or a RawRefSentinel/AiStepOpaqueArgs — the extractor's own "couldn't
// resolve this statically" markers) and, for EntityDefinition only,
// additionally checked for field-type membership via the shared
// `findUnknownEntityFieldTypes` helper (kept in sync with `extractEntity`).

import { z } from "zod";
import { type LifecycleHookType, LifecycleHookTypes } from "../constants";
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
import type { AgentRisk, ClaimKeyType, RateLimitPer } from "../types/handlers";
import type { HookPhase } from "../types/hooks";
import type { HttpRouteMethod } from "../types/http-route";
import type { NavDefinition } from "../types/nav";
import type { RelationDefinition } from "../types/relations";
import type { ScreenDefinition } from "../types/screen";
import type { TreeActionDef } from "../types/tree-node";
import type { WorkspaceDefinition } from "../types/workspace";
import { describeUnknownFieldType, findUnknownEntityFieldTypes } from "./entity-field-types";
import { AGENT_RISK_VALUES } from "./extractors/handlers";
import { isPlainObject, isRawRefSentinel } from "./extractors/shared";
import type { PatternChange, PatternId } from "./patch";
import { SYNTHETIC_LOC } from "./patcher";
import type { FeaturePatternKind } from "./patterns";
import type { SourceLocation, SourcePosition } from "./source-location";

// Derives an exhaustive literal-value array from a `Record<T, true>` flag
// map: an added/removed union member fails to compile here instead of
// silently producing a schema narrower than the runtime type — same
// rationale as kumiko-types's `NO_WIDGET_FIELD_TYPES`/`FIELD_TYPE_NAMES`.
function keysOf<T extends string>(flags: Record<T, true>): readonly T[] {
  return Object.keys(flags) as T[];
}

// =============================================================================
// Result types
// =============================================================================

export type PatternChangeIssue = {
  readonly path: string;
  readonly message: string;
};

export type PatternChangesParseResult =
  | { readonly ok: true; readonly changes: readonly PatternChange[] }
  | { readonly ok: false; readonly issues: readonly PatternChangeIssue[] };

// =============================================================================
// Shared primitives
// =============================================================================

function isPlainObjectOrSentinel(value: unknown): boolean {
  return isRawRefSentinel(value) || isPlainObject(value);
}

const sourcePositionSchema: z.ZodType<SourcePosition> = z
  .object({ line: z.number(), column: z.number() })
  .strict();

const fullSourceLocationSchema: z.ZodType<SourceLocation> = z
  .object({
    file: z.string(),
    start: sourcePositionSchema,
    end: sourcePositionSchema,
    raw: z.string(),
  })
  .strict();

// Partial object form — only `raw` is meaningful, `file`/`start`/`end` (if
// present) are accepted but discarded: a wire producer sending a
// half-populated location is telling us "this came from generated code, not
// a real file span" and `rawLoc` is exactly that contract.
const partialSourceLocationSchema = z
  .object({
    raw: z.string(),
    file: z.string().optional(),
    start: sourcePositionSchema.optional(),
    end: sourcePositionSchema.optional(),
  })
  .strict()
  .transform((value): SourceLocation => ({ ...SYNTHETIC_LOC, raw: value.raw }));

const stringSourceLocationSchema = z
  .string()
  .transform((raw): SourceLocation => ({ ...SYNTHETIC_LOC, raw }));

// `sourceBody`: string | {raw, file?, start?, end?} | full SourceLocation.
// Order matters — a fully-populated object must match `fullSourceLocationSchema`
// first so it round-trips unchanged; only a partial object falls through to
// the raw-collapsing variant.
const sourceBodySchema: z.ZodType<SourceLocation> = z.union([
  fullSourceLocationSchema,
  partialSourceLocationSchema,
  stringSourceLocationSchema,
]);

const nonEmptySourceBodySchema = sourceBodySchema.refine((loc) => loc.raw.trim().length > 0, {
  message: "source.raw must be non-empty",
});

// The pattern-level `source` field: optional on the wire, defaults to the
// patcher's own synthetic placeholder (mirrors createFeaturePatcher's
// add{Kind} methods, which never have a real file span either).
const sourceFieldSchema: z.ZodType<SourceLocation> = sourceBodySchema
  .optional()
  .default(SYNTHETIC_LOC);

// `readVarargsOrArrayProp` (extractors/shared.ts) already types a mixed
// string/sentinel array as `readonly string[]` at its own extraction
// boundary (requires.featureNames, readsConfig.qualifiedKeys); mirror that
// same typed lie here instead of re-deriving a wider array type only to
// cast it back down.
const stringOrRawRefListSchema: z.ZodType<readonly string[]> = z.custom<readonly string[]>(
  (value) =>
    Array.isArray(value) && value.every((el) => typeof el === "string" || isRawRefSentinel(el)),
  { message: "must be an array of strings or unresolved references" },
);

// Runtime source of truth for the lifecycle-hook-type literals: the
// engine's own `LifecycleHookTypes` const object (engine/constants.ts) —
// `hook`'s `hookType` is that union plus the AST-only "validation" pseudo-
// type (r.hook(type: "validation", ...) has no runtime LifecycleHookType
// counterpart, it maps to a different registrar call).
const LIFECYCLE_HOOK_TYPE_VALUES = Object.values(
  LifecycleHookTypes,
) as readonly LifecycleHookType[];

const hookTypeSchema = z.enum([...LIFECYCLE_HOOK_TYPE_VALUES, "validation"] as const);
const hookPhaseSchema = z.enum(keysOf<HookPhase>({ inTransaction: true, afterCommit: true }));
const httpRouteMethodSchema = z.enum(
  keysOf<HttpRouteMethod>({
    GET: true,
    POST: true,
    PUT: true,
    PATCH: true,
    DELETE: true,
    HEAD: true,
    OPTIONS: true,
  }),
);
const runInSchema = z.enum(keysOf<RunIn>({ api: true, worker: true, both: true }));
const claimKeyTypeSchema = z.enum(
  keysOf<ClaimKeyType>({
    string: true,
    number: true,
    boolean: true,
    "string[]": true,
    object: true,
  }),
);
const agentRiskSchema = z.enum(AGENT_RISK_VALUES as [AgentRisk, ...AgentRisk[]]);
const rateLimitPerSchema = z.enum(
  keysOf<RateLimitPer>({
    user: true,
    tenant: true,
    ip: true,
    "user+handler": true,
    "tenant+handler": true,
    "ip+handler": true,
  }),
);
const mspDeliverySchema = z.enum(
  keysOf<"shared" | "per-instance">({ shared: true, "per-instance": true }),
);

const escapeHatchSchema = z.object({ reason: z.string() }).strict();

const rateLimitOptionSchema = z
  .object({
    per: rateLimitPerSchema,
    limit: z.number(),
    windowSeconds: z.number(),
    cost: z.number().optional(),
  })
  .strict();

const agentHandlerHintsSchema = z
  .object({
    expose: z.boolean().optional(),
    risk: agentRiskSchema.optional(),
  })
  .strict();

// AccessRule — DEFAULT-DENY per its doc in types/handlers.ts; a malformed
// shape must be rejected, not silently narrowed to "no access" (that would
// hide the author's mistake instead of reporting it at the boundary).
const roleAccessRuleSchema = z
  .object({
    roles: z.array(z.string()),
    personalData: z.literal("public-intake").optional(),
  })
  .strict();

const openToAllAccessRuleSchema = z
  .object({
    openToAll: z
      .object({
        reason: z.string().refine((s) => s.trim().length > 0, {
          message: "openToAll.reason must be non-empty",
        }),
        personalData: z.literal("tenant-members").optional(),
      })
      .strict(),
  })
  .strict();

const accessRuleSchema = z.union([roleAccessRuleSchema, openToAllAccessRuleSchema]);

// Header keys per handler kind, i.e. every field besides
// kind/source/handlerName/schemaSource/handlerBody — used to reject an
// opaque handler reference (no handlerName/schemaSource/handlerBody) that
// also carries a header field. The renderer only ever emits `source.raw`
// verbatim for that shape (render.ts's handler fallback), so a header set
// alongside it would be silently dropped, never reaching the rendered
// file — reject it at the boundary instead (secure/complete by default).
const WRITE_HANDLER_HEADER_KEYS = [
  "access",
  "description",
  "agent",
  "rateLimit",
  "unsafeSkipTransitionGuard",
  "escapeHatch",
] as const;
const QUERY_HANDLER_HEADER_KEYS = [
  "access",
  "description",
  "agent",
  "rateLimit",
  "escapeHatch",
] as const;
const STREAM_HANDLER_HEADER_KEYS = ["access", "rateLimit"] as const;

function requireHandlerBody(
  val: {
    readonly handlerName?: string;
    readonly schemaSource?: SourceLocation;
    readonly handlerBody?: SourceLocation;
    readonly source: SourceLocation;
    readonly [headerKey: string]: unknown;
  },
  ctx: z.RefinementCtx,
  headerKeys: readonly string[],
): void {
  const hasAny =
    val.handlerName !== undefined ||
    val.schemaSource !== undefined ||
    val.handlerBody !== undefined;
  if (!hasAny) {
    if (val.source.raw.trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["source"],
        message:
          "an opaque handler reference (no handlerName/schemaSource/handlerBody) requires a non-empty source.raw",
      });
    }
    for (const key of headerKeys) {
      if (val[key] !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message:
            "not rendered for an opaque handler reference; provide handlerName, schemaSource and handlerBody",
        });
      }
    }
    return;
  }
  if (val.handlerName === undefined || val.handlerName.trim().length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["handlerName"],
      message: "handlerName is required and must be non-empty",
    });
  }
  if (val.schemaSource === undefined) {
    ctx.addIssue({ code: "custom", path: ["schemaSource"], message: "schemaSource is required" });
  }
  if (val.handlerBody === undefined) {
    ctx.addIssue({ code: "custom", path: ["handlerBody"], message: "handlerBody is required" });
  }
}

// =============================================================================
// Static patterns
// =============================================================================

// Deep-definition passthrough: accepts a plain object OR the extractor's
// own "couldn't resolve this statically" sentinel (RawRefSentinel), typed
// as `T` at the boundary — the same "typed lie" the extractors already
// make (e.g. round2.ts's `definition as EntityDefinition`), because a
// sentinel-bearing value is never actually shaped like `T` at runtime, but
// round-trips through `applyChanges`/the renderer unexamined either way.
function passthroughSchema<T>(): z.ZodType<T> {
  return z.custom<T>(isPlainObjectOrSentinel, {
    message: "must be a plain object or unresolved reference",
  });
}

const entityDefinitionSchema = passthroughSchema<EntityDefinition>().superRefine((value, ctx) => {
  for (const entry of findUnknownEntityFieldTypes(value)) {
    ctx.addIssue({
      code: "custom",
      path: ["fields", entry.fieldName, "type"],
      message: describeUnknownFieldType(entry),
    });
  }
});

const entitySchema = z
  .object({
    kind: z.literal("entity"),
    source: sourceFieldSchema,
    entityName: z.string(),
    definition: entityDefinitionSchema,
  })
  .strict();

const relationSchema = z
  .object({
    kind: z.literal("relation"),
    source: sourceFieldSchema,
    entityName: z.string(),
    relationName: z.string(),
    definition: passthroughSchema<RelationDefinition>(),
  })
  .strict();

const navSchema = z
  .object({
    kind: z.literal("nav"),
    source: sourceFieldSchema,
    definition: passthroughSchema<NavDefinition>(),
  })
  .strict();

const workspaceSchema = z
  .object({
    kind: z.literal("workspace"),
    source: sourceFieldSchema,
    definition: passthroughSchema<WorkspaceDefinition>(),
  })
  .strict();

const configSchema = z
  .object({
    kind: z.literal("config"),
    source: sourceFieldSchema,
    keys: passthroughSchema<Readonly<Record<string, ConfigKeyDefinition<ConfigKeyType>>>>(),
  })
  .strict();

const translationsSchema = z
  .object({
    kind: z.literal("translations"),
    source: sourceFieldSchema,
    keys: passthroughSchema<TranslationKeys>(),
  })
  .strict();

const requiresSchema = z
  .object({
    kind: z.literal("requires"),
    source: sourceFieldSchema,
    featureNames: stringOrRawRefListSchema,
  })
  .strict();

const optionalRequiresSchema = z
  .object({
    kind: z.literal("optionalRequires"),
    source: sourceFieldSchema,
    featureNames: stringOrRawRefListSchema,
  })
  .strict();

const systemScopeSchema = z
  .object({
    kind: z.literal("systemScope"),
    source: sourceFieldSchema,
  })
  .strict();

const toggleableSchema = z
  .object({
    kind: z.literal("toggleable"),
    source: sourceFieldSchema,
    default: z.boolean(),
  })
  .strict();

const describeSchema = z
  .object({
    kind: z.literal("describe"),
    source: sourceFieldSchema,
    text: z.string().refine((s) => s.trim().length > 0, { message: "text must be non-empty" }),
  })
  .strict();

const uiHintsSchema = z
  .object({
    kind: z.literal("uiHints"),
    source: nonEmptySourceBodySchema,
  })
  .strict();

const metricSchema = z
  .object({
    kind: z.literal("metric"),
    source: sourceFieldSchema,
    shortName: z.string(),
    options: passthroughSchema<MetricOptions>(),
  })
  .strict();

const secretSchema = z
  .object({
    kind: z.literal("secret"),
    source: sourceFieldSchema,
    shortName: z.string(),
    options: passthroughSchema<SecretOptions>(),
  })
  .strict();

const claimKeySchema = z
  .object({
    kind: z.literal("claimKey"),
    source: sourceFieldSchema,
    shortName: z.string(),
    claimType: claimKeyTypeSchema,
  })
  .strict();

const referenceDataSchema = z
  .object({
    kind: z.literal("referenceData"),
    source: sourceFieldSchema,
    entityName: z.string(),
    data: z.custom<ReferenceDataDef["data"]>(
      (value) => Array.isArray(value) || isRawRefSentinel(value),
      { message: "data must be an array or unresolved reference" },
    ),
    upsertKey: z.string().optional(),
  })
  .strict();

const readsConfigSchema = z
  .object({
    kind: z.literal("readsConfig"),
    source: sourceFieldSchema,
    qualifiedKeys: stringOrRawRefListSchema,
  })
  .strict();

const useExtensionSchema = z
  .object({
    kind: z.literal("useExtension"),
    source: sourceFieldSchema,
    extensionName: z.string(),
    extensionNameRaw: z.string().optional(),
    entityName: z.string(),
    options: passthroughSchema<Readonly<Record<string, unknown>>>().optional(),
  })
  .strict();

const usesApiSchema = z
  .object({
    kind: z.literal("usesApi"),
    source: sourceFieldSchema,
    apiName: z.string(),
  })
  .strict();

const exposesApiSchema = z
  .object({
    kind: z.literal("exposesApi"),
    source: sourceFieldSchema,
    apiName: z.string(),
  })
  .strict();

const treeActionsSchema = z
  .object({
    kind: z.literal("treeActions"),
    source: sourceFieldSchema,
    definitions: passthroughSchema<Readonly<Record<string, TreeActionDef>>>(),
  })
  .strict();

// =============================================================================
// Mixed patterns
// =============================================================================

const screenSchema = z
  .object({
    kind: z.literal("screen"),
    source: sourceFieldSchema,
    definition: passthroughSchema<ScreenDefinition>(),
    opaqueProps: z.record(z.string(), sourceBodySchema).optional().default({}),
  })
  .strict();

const writeHandlerSchema = z
  .object({
    kind: z.literal("writeHandler"),
    source: sourceFieldSchema,
    handlerName: z.string().optional(),
    schemaSource: sourceBodySchema.optional(),
    handlerBody: sourceBodySchema.optional(),
    access: accessRuleSchema.optional(),
    description: z.string().optional(),
    agent: agentHandlerHintsSchema.optional(),
    rateLimit: rateLimitOptionSchema.optional(),
    unsafeSkipTransitionGuard: z.boolean().optional(),
    escapeHatch: escapeHatchSchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => requireHandlerBody(val, ctx, WRITE_HANDLER_HEADER_KEYS));

const queryHandlerSchema = z
  .object({
    kind: z.literal("queryHandler"),
    source: sourceFieldSchema,
    handlerName: z.string().optional(),
    schemaSource: sourceBodySchema.optional(),
    handlerBody: sourceBodySchema.optional(),
    access: accessRuleSchema.optional(),
    description: z.string().optional(),
    agent: agentHandlerHintsSchema.optional(),
    rateLimit: rateLimitOptionSchema.optional(),
    escapeHatch: escapeHatchSchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => requireHandlerBody(val, ctx, QUERY_HANDLER_HEADER_KEYS));

const streamHandlerSchema = z
  .object({
    kind: z.literal("streamHandler"),
    source: sourceFieldSchema,
    handlerName: z.string().optional(),
    schemaSource: sourceBodySchema.optional(),
    handlerBody: sourceBodySchema.optional(),
    access: accessRuleSchema.optional(),
    rateLimit: rateLimitOptionSchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => requireHandlerBody(val, ctx, STREAM_HANDLER_HEADER_KEYS));

const hookTargetSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.object({ allOf: z.string() }).strict(),
]);

const hookSchema = z
  .object({
    kind: z.literal("hook"),
    source: sourceFieldSchema,
    hookType: hookTypeSchema,
    target: hookTargetSchema,
    fnBody: sourceBodySchema,
    phase: hookPhaseSchema.optional(),
    escapeHatch: escapeHatchSchema.optional(),
  })
  .strict();

const jobSchema = z
  .object({
    kind: z.literal("job"),
    source: sourceFieldSchema,
    jobName: z.string(),
    options: passthroughSchema<Omit<JobDefinition, "name" | "handler">>(),
    handlerBody: sourceBodySchema,
  })
  .strict();

const notificationSchema = z
  .object({
    kind: z.literal("notification"),
    source: sourceFieldSchema,
    notificationName: z.string(),
    trigger: z.object({ on: z.string() }).strict(),
    recipientBody: sourceBodySchema,
    dataBody: sourceBodySchema,
    templates: z.record(z.string(), sourceBodySchema).optional(),
  })
  .strict();

const authClaimsSchema = z
  .object({
    kind: z.literal("authClaims"),
    source: sourceFieldSchema,
    fnBody: sourceBodySchema,
  })
  .strict();

const httpRouteSchema = z
  .object({
    kind: z.literal("httpRoute"),
    source: sourceFieldSchema,
    method: httpRouteMethodSchema,
    path: z.string(),
    anonymous: z.boolean(),
    handlerBody: sourceBodySchema,
  })
  .strict();

const projectionSchema = z
  .object({
    kind: z.literal("projection"),
    source: sourceFieldSchema,
    name: z.string(),
    sourceEntity: z.union([z.string(), z.array(z.string())]),
    applyBodies: z.record(z.string(), sourceBodySchema),
  })
  .strict();

const mspErrorPolicySchema = z.object({ skipApplyErrors: z.boolean().optional() }).strict();
const mspErrorModeSchema = z
  .object({
    continuous: mspErrorPolicySchema.optional(),
    rebuild: mspErrorPolicySchema.optional(),
  })
  .strict();

const multiStreamProjectionSchema = z
  .object({
    kind: z.literal("multiStreamProjection"),
    source: sourceFieldSchema,
    name: z.string(),
    applyBodies: z.record(z.string(), sourceBodySchema),
    errorMode: mspErrorModeSchema.optional(),
    runIn: runInSchema.optional(),
    delivery: mspDeliverySchema.optional(),
  })
  .strict();

const defineEventSchema = z
  .object({
    kind: z.literal("defineEvent"),
    source: sourceFieldSchema,
    eventName: z.string(),
    eventNameRaw: z.string().optional(),
    schemaSource: sourceBodySchema,
    version: z.number().optional(),
    piiFields: sourceBodySchema,
    migrations: z.record(z.string(), sourceBodySchema).optional(),
  })
  .strict();

const extendsRegistrarSchema = z
  .object({
    kind: z.literal("extendsRegistrar"),
    source: sourceFieldSchema,
    extensionName: z.string(),
    extensionNameRaw: z.string().optional(),
    defBody: sourceBodySchema,
  })
  .strict();

const envSchemaSchema = z
  .object({
    kind: z.literal("envSchema"),
    source: sourceFieldSchema,
    schemaBody: sourceBodySchema,
  })
  .strict();

const aiStepOpaqueArgsSchema = z.custom<{ readonly __raw: string }>(isRawRefSentinel, {
  message: "must be an unresolved reference ({ __raw })",
});

const aiStepPolicySchema = z
  .object({
    enabled: z.boolean(),
    providerId: z.string().optional(),
    model: z.string().optional(),
    params: z.custom<Record<string, unknown>>(isPlainObject, {
      message: "params must be a plain object",
    }),
  })
  .strict();

const stringOrAiOpaqueSchema = z.union([z.string(), aiStepOpaqueArgsSchema]);
const aiStepPolicyOrOpaqueSchema = z.union([aiStepPolicySchema, aiStepOpaqueArgsSchema]);

const aiGenerateSchema = z
  .object({
    kind: z.literal("ai.generate"),
    source: sourceFieldSchema,
    argsSource: aiStepOpaqueArgsSchema.optional(),
    stepKey: stringOrAiOpaqueSchema.optional(),
    promptKey: stringOrAiOpaqueSchema.optional(),
    promptFallback: stringOrAiOpaqueSchema.optional(),
    defaults: aiStepPolicyOrOpaqueSchema.optional(),
    paramsSchemaSource: sourceBodySchema.optional(),
    inputBody: sourceBodySchema.optional(),
  })
  .strict();

const aiExtractSchema = z
  .object({
    kind: z.literal("ai.extract"),
    source: sourceFieldSchema,
    argsSource: aiStepOpaqueArgsSchema.optional(),
    stepKey: stringOrAiOpaqueSchema.optional(),
    promptKey: stringOrAiOpaqueSchema.optional(),
    promptFallback: stringOrAiOpaqueSchema.optional(),
    defaults: aiStepPolicyOrOpaqueSchema.optional(),
    paramsSchemaSource: sourceBodySchema.optional(),
    outputSchemaSource: sourceBodySchema.optional(),
    instructionsBody: sourceBodySchema.optional(),
    documentBody: sourceBodySchema.optional(),
  })
  .strict();

const aiClassifySchema = z
  .object({
    kind: z.literal("ai.classify"),
    source: sourceFieldSchema,
    argsSource: aiStepOpaqueArgsSchema.optional(),
    stepKey: stringOrAiOpaqueSchema.optional(),
    promptKey: stringOrAiOpaqueSchema.optional(),
    promptFallback: stringOrAiOpaqueSchema.optional(),
    defaults: aiStepPolicyOrOpaqueSchema.optional(),
    paramsSchemaSource: sourceBodySchema.optional(),
    actions: z.array(z.object({ type: z.string(), description: z.string() }).strict()).optional(),
    inputBody: sourceBodySchema.optional(),
  })
  .strict();

// =============================================================================
// Catch-all
// =============================================================================

const unknownPatternSchema = z
  .object({
    kind: z.literal("unknown"),
    source: nonEmptySourceBodySchema,
    methodName: z.string(),
  })
  .strict();

// =============================================================================
// Pattern union — Record keyed by kind doubles as the exhaustiveness pin
// consumed by the compile-time typtest (a missing/renamed kind fails to
// compile here, same contract as patterns.ts's own switch statements).
// =============================================================================

export const PATTERN_SCHEMAS_BY_KIND = {
  entity: entitySchema,
  relation: relationSchema,
  nav: navSchema,
  workspace: workspaceSchema,
  config: configSchema,
  translations: translationsSchema,
  requires: requiresSchema,
  optionalRequires: optionalRequiresSchema,
  systemScope: systemScopeSchema,
  toggleable: toggleableSchema,
  describe: describeSchema,
  uiHints: uiHintsSchema,
  metric: metricSchema,
  secret: secretSchema,
  claimKey: claimKeySchema,
  referenceData: referenceDataSchema,
  readsConfig: readsConfigSchema,
  useExtension: useExtensionSchema,
  usesApi: usesApiSchema,
  exposesApi: exposesApiSchema,
  treeActions: treeActionsSchema,
  screen: screenSchema,
  writeHandler: writeHandlerSchema,
  queryHandler: queryHandlerSchema,
  streamHandler: streamHandlerSchema,
  hook: hookSchema,
  job: jobSchema,
  notification: notificationSchema,
  authClaims: authClaimsSchema,
  httpRoute: httpRouteSchema,
  projection: projectionSchema,
  multiStreamProjection: multiStreamProjectionSchema,
  defineEvent: defineEventSchema,
  extendsRegistrar: extendsRegistrarSchema,
  envSchema: envSchemaSchema,
  "ai.generate": aiGenerateSchema,
  "ai.extract": aiExtractSchema,
  "ai.classify": aiClassifySchema,
  unknown: unknownPatternSchema,
} satisfies Record<FeaturePatternKind, z.ZodTypeAny>;

const patternSchema = z.discriminatedUnion("kind", [
  entitySchema,
  relationSchema,
  navSchema,
  workspaceSchema,
  configSchema,
  translationsSchema,
  requiresSchema,
  optionalRequiresSchema,
  systemScopeSchema,
  toggleableSchema,
  describeSchema,
  uiHintsSchema,
  metricSchema,
  secretSchema,
  claimKeySchema,
  referenceDataSchema,
  readsConfigSchema,
  useExtensionSchema,
  usesApiSchema,
  exposesApiSchema,
  treeActionsSchema,
  screenSchema,
  writeHandlerSchema,
  queryHandlerSchema,
  streamHandlerSchema,
  hookSchema,
  jobSchema,
  notificationSchema,
  authClaimsSchema,
  httpRouteSchema,
  projectionSchema,
  multiStreamProjectionSchema,
  defineEventSchema,
  extendsRegistrarSchema,
  envSchemaSchema,
  aiGenerateSchema,
  aiExtractSchema,
  aiClassifySchema,
  unknownPatternSchema,
]);

// =============================================================================
// PatternId union
// =============================================================================

const patternIdEntitySchema = z
  .object({ kind: z.literal("entity"), entityName: z.string() })
  .strict();
const patternIdRelationSchema = z
  .object({ kind: z.literal("relation"), entityName: z.string(), relationName: z.string() })
  .strict();
const patternIdNavSchema = z.object({ kind: z.literal("nav"), id: z.string() }).strict();
const patternIdWorkspaceSchema = z
  .object({ kind: z.literal("workspace"), id: z.string() })
  .strict();
const patternIdScreenSchema = z.object({ kind: z.literal("screen"), id: z.string() }).strict();
const patternIdWriteHandlerSchema = z
  .object({ kind: z.literal("writeHandler"), handlerName: z.string() })
  .strict();
const patternIdQueryHandlerSchema = z
  .object({ kind: z.literal("queryHandler"), handlerName: z.string() })
  .strict();
const patternIdStreamHandlerSchema = z
  .object({ kind: z.literal("streamHandler"), handlerName: z.string() })
  .strict();
const patternIdHookSchema = z
  .object({
    kind: z.literal("hook"),
    hookType: z.string(),
    target: z.union([z.string(), z.object({ allOf: z.string() }).strict()]),
  })
  .strict();
const patternIdMetricSchema = z
  .object({ kind: z.literal("metric"), shortName: z.string() })
  .strict();
const patternIdSecretSchema = z
  .object({ kind: z.literal("secret"), shortName: z.string() })
  .strict();
const patternIdClaimKeySchema = z
  .object({ kind: z.literal("claimKey"), shortName: z.string() })
  .strict();
const patternIdReferenceDataSchema = z
  .object({ kind: z.literal("referenceData"), entityName: z.string() })
  .strict();
const patternIdUseExtensionSchema = z
  .object({ kind: z.literal("useExtension"), extensionName: z.string(), entityName: z.string() })
  .strict();
const patternIdJobSchema = z.object({ kind: z.literal("job"), jobName: z.string() }).strict();
const patternIdNotificationSchema = z
  .object({ kind: z.literal("notification"), notificationName: z.string() })
  .strict();
const patternIdHttpRouteSchema = z
  .object({ kind: z.literal("httpRoute"), method: z.string(), path: z.string() })
  .strict();
const patternIdProjectionSchema = z
  .object({ kind: z.literal("projection"), name: z.string() })
  .strict();
const patternIdMultiStreamProjectionSchema = z
  .object({ kind: z.literal("multiStreamProjection"), name: z.string() })
  .strict();
const patternIdDefineEventSchema = z
  .object({ kind: z.literal("defineEvent"), eventName: z.string() })
  .strict();
const patternIdExtendsRegistrarSchema = z
  .object({ kind: z.literal("extendsRegistrar"), extensionName: z.string() })
  .strict();
const patternIdAiGenerateSchema = z
  .object({ kind: z.literal("ai.generate"), stepKey: z.string() })
  .strict();
const patternIdAiExtractSchema = z
  .object({ kind: z.literal("ai.extract"), stepKey: z.string() })
  .strict();
const patternIdAiClassifySchema = z
  .object({ kind: z.literal("ai.classify"), stepKey: z.string() })
  .strict();
const patternIdRequiresSchema = z.object({ kind: z.literal("requires") }).strict();
const patternIdOptionalRequiresSchema = z.object({ kind: z.literal("optionalRequires") }).strict();
const patternIdReadsConfigSchema = z.object({ kind: z.literal("readsConfig") }).strict();
const patternIdSystemScopeSchema = z.object({ kind: z.literal("systemScope") }).strict();
const patternIdToggleableSchema = z.object({ kind: z.literal("toggleable") }).strict();
const patternIdDescribeSchema = z.object({ kind: z.literal("describe") }).strict();
const patternIdUiHintsSchema = z.object({ kind: z.literal("uiHints") }).strict();
const patternIdConfigSchema = z.object({ kind: z.literal("config") }).strict();
const patternIdTranslationsSchema = z.object({ kind: z.literal("translations") }).strict();
const patternIdAuthClaimsSchema = z.object({ kind: z.literal("authClaims") }).strict();
const patternIdTreeActionsSchema = z.object({ kind: z.literal("treeActions") }).strict();

export const PATTERN_ID_SCHEMAS_BY_KIND = {
  entity: patternIdEntitySchema,
  relation: patternIdRelationSchema,
  nav: patternIdNavSchema,
  workspace: patternIdWorkspaceSchema,
  screen: patternIdScreenSchema,
  writeHandler: patternIdWriteHandlerSchema,
  queryHandler: patternIdQueryHandlerSchema,
  streamHandler: patternIdStreamHandlerSchema,
  hook: patternIdHookSchema,
  metric: patternIdMetricSchema,
  secret: patternIdSecretSchema,
  claimKey: patternIdClaimKeySchema,
  referenceData: patternIdReferenceDataSchema,
  useExtension: patternIdUseExtensionSchema,
  job: patternIdJobSchema,
  notification: patternIdNotificationSchema,
  httpRoute: patternIdHttpRouteSchema,
  projection: patternIdProjectionSchema,
  multiStreamProjection: patternIdMultiStreamProjectionSchema,
  defineEvent: patternIdDefineEventSchema,
  extendsRegistrar: patternIdExtendsRegistrarSchema,
  "ai.generate": patternIdAiGenerateSchema,
  "ai.extract": patternIdAiExtractSchema,
  "ai.classify": patternIdAiClassifySchema,
  requires: patternIdRequiresSchema,
  optionalRequires: patternIdOptionalRequiresSchema,
  readsConfig: patternIdReadsConfigSchema,
  systemScope: patternIdSystemScopeSchema,
  toggleable: patternIdToggleableSchema,
  describe: patternIdDescribeSchema,
  uiHints: patternIdUiHintsSchema,
  config: patternIdConfigSchema,
  translations: patternIdTranslationsSchema,
  authClaims: patternIdAuthClaimsSchema,
  treeActions: patternIdTreeActionsSchema,
} satisfies Record<PatternId["kind"], z.ZodTypeAny>;

const patternIdSchema = z.discriminatedUnion("kind", [
  patternIdEntitySchema,
  patternIdRelationSchema,
  patternIdNavSchema,
  patternIdWorkspaceSchema,
  patternIdScreenSchema,
  patternIdWriteHandlerSchema,
  patternIdQueryHandlerSchema,
  patternIdStreamHandlerSchema,
  patternIdHookSchema,
  patternIdMetricSchema,
  patternIdSecretSchema,
  patternIdClaimKeySchema,
  patternIdReferenceDataSchema,
  patternIdUseExtensionSchema,
  patternIdJobSchema,
  patternIdNotificationSchema,
  patternIdHttpRouteSchema,
  patternIdProjectionSchema,
  patternIdMultiStreamProjectionSchema,
  patternIdDefineEventSchema,
  patternIdExtendsRegistrarSchema,
  patternIdAiGenerateSchema,
  patternIdAiExtractSchema,
  patternIdAiClassifySchema,
  patternIdRequiresSchema,
  patternIdOptionalRequiresSchema,
  patternIdReadsConfigSchema,
  patternIdSystemScopeSchema,
  patternIdToggleableSchema,
  patternIdDescribeSchema,
  patternIdUiHintsSchema,
  patternIdConfigSchema,
  patternIdTranslationsSchema,
  patternIdAuthClaimsSchema,
  patternIdTreeActionsSchema,
]);

// =============================================================================
// Change union — `rationale` is accepted (optional, on every member) and
// dropped when the final PatternChange is assembled below (plain field
// selection, not a schema-level transform — see file-header rationale).
// =============================================================================

const addChangeSchema = z
  .object({
    op: z.literal("add"),
    pattern: patternSchema,
    rationale: z.string().optional(),
  })
  .strict();

const replaceChangeSchema = z
  .object({
    op: z.literal("replace"),
    id: patternIdSchema,
    pattern: patternSchema,
    rationale: z.string().optional(),
  })
  .strict();

const removeChangeSchema = z
  .object({
    op: z.literal("remove"),
    id: patternIdSchema,
    rationale: z.string().optional(),
  })
  .strict();

const changeSchema = z.discriminatedUnion("op", [
  addChangeSchema,
  replaceChangeSchema,
  removeChangeSchema,
]);

// =============================================================================
// Issue formatting
// =============================================================================

function formatPath(index: number, path: readonly PropertyKey[]): string {
  let out = `changes[${index}]`;
  for (const segment of path) {
    out += typeof segment === "number" ? `[${segment}]` : `.${String(segment)}`;
  }
  return out;
}

function getAtPath(root: unknown, path: readonly PropertyKey[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (isPlainObject(current)) {
      current = current[String(segment)];
    } else if (Array.isArray(current) && typeof segment === "number") {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

// zod v4 reports `.strict()` violations as a single `unrecognized_keys`
// issue per offending object, carrying all extra key names at once. We
// split it into one PatternChangeIssue per key so each unexpected key gets
// its own actionable path — except `definition` on a handler-kind pattern
// nesting an `access` sub-key, which gets the more specific message the
// spec calls for (a caller who nests `access` under a stray `definition`
// key is making one specific, common mistake, not an arbitrary unknown key).
// Only these kinds render a top-level `access`; on any other kind the hint
// would send the caller into a second rejection.
function isKindWithTopLevelAccess(kind: unknown): boolean {
  return kind === "writeHandler" || kind === "queryHandler" || kind === "streamHandler";
}

function formatZodIssues(
  issues: readonly z.core.$ZodIssue[],
  index: number,
  rawItem: unknown,
): PatternChangeIssue[] {
  const out: PatternChangeIssue[] = [];
  for (const issue of issues) {
    if (issue.code === "unrecognized_keys") {
      const parentValue = getAtPath(rawItem, issue.path);
      for (const key of issue.keys) {
        const keyValue = isPlainObject(parentValue) ? parentValue[key] : undefined;
        if (
          key === "definition" &&
          isPlainObject(parentValue) &&
          isKindWithTopLevelAccess(parentValue["kind"]) &&
          isPlainObject(keyValue) &&
          "access" in keyValue
        ) {
          out.push({
            path: `${formatPath(index, issue.path)}.definition.access`,
            message: "unexpected key; access belongs at top level of the pattern",
          });
          continue;
        }
        out.push({
          path: `${formatPath(index, issue.path)}.${key}`,
          message: "unexpected key",
        });
      }
      continue;
    }
    out.push({ path: formatPath(index, issue.path), message: issue.message });
  }
  return out;
}

// =============================================================================
// Public API
// =============================================================================

export function parsePatternChanges(input: unknown): PatternChangesParseResult {
  if (!Array.isArray(input)) {
    return { ok: false, issues: [{ path: "changes", message: "must be an array" }] };
  }

  const issues: PatternChangeIssue[] = [];
  const changes: PatternChange[] = [];

  input.forEach((item, index) => {
    const result = changeSchema.safeParse(item);
    if (!result.success) {
      issues.push(...formatZodIssues(result.error.issues, index, item));
      return;
    }
    const value = result.data;
    if (value.op === "replace" && value.id.kind !== value.pattern.kind) {
      issues.push({
        path: `changes[${index}].pattern.kind`,
        message: `pattern.kind "${value.pattern.kind}" does not match id.kind "${value.id.kind}"`,
      });
      return;
    }
    if (value.op === "add") {
      changes.push({ op: "add", pattern: value.pattern });
    } else if (value.op === "replace") {
      changes.push({ op: "replace", id: value.id, pattern: value.pattern });
    } else {
      changes.push({ op: "remove", id: value.id });
    }
  });

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, changes };
}
