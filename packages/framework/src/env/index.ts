// Env-Schema composition for Kumiko apps.
//
// Each feature declares its required env-vars via `r.envSchema(z.object({...}))`.
// `composeEnvSchema({ features, extend })` merges those into one app-wide
// Zod-object that `runProdApp` validates `process.env` against at boot.
//
// On invalid/missing vars `parseEnv` throws `KumikoBootError` with ALL
// problems aggregated (Zod's safeParse traverses every field before
// short-circuiting). `runProdApp` catches at its top level and renders
// via `KumikoBootError.format()` — so apps don't repeat the try/catch.
//
// Per-var metadata for deploy-time tooling (Pulumi-config-key override,
// generator command, k8s hints) lives in Zod's `.meta({ kumiko: {...} })`.
// Without meta, defaults: `camelCase(envVarName)` for the Pulumi key,
// `<set-me>` placeholder for the value, no `--secret` flag.

import * as z from "zod";
import type { FeatureDefinition } from "../engine/types/feature.ts";
import { zodDef, zodMeta, zodShape, zodShapeField } from "./_zod-introspect.ts";
import {
  buildPulumiSuggestion,
  type ComposedEnvShape,
  type ComposeEnvSchemaOptions,
  type EmptyShape,
  type EnvError,
  type EnvErrorKind,
  type EnvFieldClass,
  type EnvFieldStatus,
  getFieldDescription,
  type KumikoEnvMeta,
  type ParseEnvOptions,
} from "./internals.ts";

export { type EnvSource, requiredEnvFor } from "./required-env.ts";

// --- Per-env-var metadata (attach via Zod's `.meta()`) ---

function isKumikoMeta(value: unknown): value is KumikoEnvMeta {
  if (value === null || typeof value !== "object") return false;
  // @cast-boundary schema-walk — runtime-shape narrowing of zod-meta payload
  const v = value as { pulumi?: unknown; kms?: unknown };
  if (v.kms !== undefined && v.kms !== true) return false;
  if (v.pulumi === undefined) return true;
  if (v.pulumi === null || typeof v.pulumi !== "object") return false;
  // @cast-boundary schema-walk
  const p = v.pulumi as { name?: unknown; generator?: unknown; secret?: unknown };
  if (p.name !== undefined && typeof p.name !== "string") return false;
  if (p.generator !== undefined && typeof p.generator !== "string") return false;
  if (p.secret !== undefined && typeof p.secret !== "boolean") return false;
  return true;
}

export function readKumikoMeta(field: z.ZodType): KumikoEnvMeta {
  const meta = zodMeta(field);
  if (meta && typeof meta === "object" && meta !== null && "kumiko" in meta) {
    // @cast-boundary schema-walk
    const k = (meta as { kumiko?: unknown }).kumiko;
    if (isKumikoMeta(k)) return k;
  }
  return {};
}

/** Env names whose schema field declares `kms: true` — the slots
 *  `resolvePlatformKeks` resolves from a ciphertext. */
export function kmsSlotsOf(schema: z.ZodObject<z.ZodRawShape>): readonly string[] {
  return Object.entries(zodShape(schema))
    .filter(([, field]) => readKumikoMeta(field).kms === true)
    .map(([name]) => name);
}

// A ciphertext-only slot is satisfied by its `_CIPHERTEXT` twin: the plaintext
// only exists after the boot-time decrypt, so requiring it here would reject
// exactly the deployment this meta enables. safeExtend, not extend: Zod 4 throws
// on extend for schemas carrying refinements (app-level superRefine).
// Caveat: refinements run against the relaxed object, so they see such a slot as
// `undefined` despite `z.infer<S>` promising a string. A refinement that reads the
// slot must tolerate that; a throw from it is reported by parseEnv as a boot error.
function relaxCiphertextOnlySlots<S extends z.ZodObject<z.ZodRawShape>>(
  schema: S,
  env: Readonly<Record<string, string>>,
): z.ZodObject<z.ZodRawShape> {
  const shape = zodShape(schema);
  const relaxed: Record<string, z.ZodType> = {};
  for (const name of kmsSlotsOf(schema)) {
    const field = shape[name];
    if (field && env[name] === undefined && env[`${name}_CIPHERTEXT`])
      relaxed[name] = field.optional();
  }
  return Object.keys(relaxed).length === 0 ? schema : schema.safeExtend(relaxed);
}

// --- Field-classification helpers (Zod v4 introspection) ---

export function classifyField(field: z.ZodType): EnvFieldClass {
  // Drill through ZodEffects/ZodPipe wrappers to find the inner kind.
  let current: z.ZodType = field;
  for (let i = 0; i < 8; i++) {
    if (current instanceof z.ZodDefault) return "withDefault";
    // `.required()` on an object wraps optional fields in nonoptional(); the
    // wrapper makes the field required, whatever the optional beneath it says.
    if (current instanceof z.ZodNonOptional) {
      const beneath = zodDef(current)?.innerType;
      if (beneath instanceof z.ZodOptional) {
        const unwrapped = zodDef(beneath)?.innerType;
        if (unwrapped === undefined) return "required";
        current = unwrapped;
        continue;
      }
    }
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      return "optional";
    }
    const inner = zodDef(current);
    if (inner?.innerType) {
      current = inner.innerType;
      continue;
    }
    if (inner?.in) {
      current = inner.in;
      continue;
    }
    break;
  }
  return "required";
}

// @wrapper-known semantic-alias
// --- Typed feature env ---

/** A feature whose registered env schema is visible in its type, so
 *  `composeEnvSchema` can type the merged schema from the feature list. */
export type FeatureWithEnvSchema<
  TFeature extends FeatureDefinition,
  TShape extends z.ZodRawShape,
> = TFeature & { readonly envSchema: z.ZodObject<TShape> };

function registersEnvSchema<TFeature extends FeatureDefinition, TShape extends z.ZodRawShape>(
  feature: TFeature,
  schema: z.ZodObject<TShape>,
): feature is FeatureWithEnvSchema<TFeature, TShape> {
  return feature.envSchema === schema;
}

/** Returns `feature` typed with the env schema it registered via
 *  `r.envSchema(schema)`. Throws when the feature registered another
 *  instance, so the type never claims fields the runtime schema lacks. */
export function featureWithEnvSchema<
  TFeature extends FeatureDefinition,
  TShape extends z.ZodRawShape,
>(feature: TFeature, schema: z.ZodObject<TShape>): FeatureWithEnvSchema<TFeature, TShape> {
  if (!registersEnvSchema(feature, schema)) {
    throw new Error(
      `[Feature ${feature.name}] featureWithEnvSchema: the feature did not register this schema instance via r.envSchema().`,
    );
  }
  return feature;
}

// A feature typed as plain FeatureDefinition carries `ZodRawShape`, whose
// index signature would swallow every typed key of the intersection.
// --- Compose ---
export type ComposedEnvSchema<TShape extends z.ZodRawShape = z.ZodRawShape> = {
  /** The merged Zod schema, typed from core, the typed feature fragments and
   *  extend; `parseEnv(composed.schema, env)` returns the typed env. */
  readonly schema: z.ZodObject<TShape>;
  /** env-var-name → declaring source-name: feature-name from `r.envSchema()`,
   *  "app" from `extend`, or "framework-core" from `core`. */
  readonly sources: Readonly<Record<string, string>>;
};

// `.optional()` returns a new Zod instance that drops `.meta()`, which would
// hide the slot from `kmsSlotsOf` on the composed schema.
function optionalKeepingKmsMeta(field: z.ZodType): z.ZodType {
  const optional = field.optional();
  return readKumikoMeta(field).kms === true
    ? optional.meta({ kumiko: readKumikoMeta(field) })
    : optional;
}

/** Makes the named env keys optional while keeping their `kms` meta. Keys
 *  missing from the schema shape are ignored. */
export function withOptionalEnvKeys(
  schema: z.ZodObject<z.ZodRawShape>,
  keys: readonly string[],
): z.ZodObject<z.ZodRawShape> {
  const shape = zodShape(schema);
  const relaxed: Record<string, z.ZodType> = {};
  for (const key of keys) {
    const field = shape[key];
    if (field) relaxed[key] = optionalKeepingKmsMeta(field);
  }
  return Object.keys(relaxed).length === 0 ? schema : schema.safeExtend(relaxed);
}

// The very same field instance is a shared fragment (several features read one
// variable), not a conflict; the first declaring feature owns it.
function isSharedFeatureFragment(
  featureFields: ReadonlyMap<string, z.ZodType>,
  key: string,
  field: z.ZodType,
): boolean {
  return featureFields.get(key) === field;
}

// Required beats optional, independent of feature order: a feature outside
// optionalFeatures must not end up with a silently optional slot.
function keepStrictestOfSharedFragment(
  merged: Record<string, z.ZodType>,
  key: string,
  field: z.ZodType,
  declaringFeatureIsOptional: boolean,
): void {
  if (!declaringFeatureIsOptional) merged[key] = field;
}

function envVarConflictError(key: string, firstOwner: string | undefined, secondOwner: string) {
  return new KumikoBootError([
    {
      name: key,
      kind: "invalid",
      message:
        `env-var conflict: "${key}" declared by both ` +
        `"${firstOwner}" and "${secondOwner}" — pick one owner.`,
    },
  ]);
}

// The twin follows from the slot, so a versioned family (`…_V2`) needs no
// second declaration. An already declared twin (apps that predate this) stays.
function declareKmsCiphertextTwins(
  merged: Record<string, z.ZodType>,
  sources: Record<string, string>,
  kmsFields: readonly { readonly name: string; readonly source: string }[],
): void {
  for (const { name, source } of kmsFields) {
    const twin = `${name}_CIPHERTEXT`;
    if (merged[twin] !== undefined) continue;
    merged[twin] = z
      .string()
      .min(1)
      .optional()
      .describe(`Key-Manager ciphertext of ${name}; used when ${name} is unset.`);
    sources[twin] = source;
  }
}

export function composeEnvSchema<
  const TFeatures extends readonly FeatureDefinition[],
  TCore extends z.ZodRawShape = EmptyShape,
  TExtend extends z.ZodRawShape = EmptyShape,
  const TOptionalFeatures extends readonly string[] | undefined = undefined,
>(
  options: ComposeEnvSchemaOptions<TFeatures, TCore, TExtend, TOptionalFeatures>,
): ComposedEnvSchema<ComposedEnvShape<TFeatures, TCore, TExtend, TOptionalFeatures>> {
  const optionalSet = new Set(options.optionalFeatures ?? []);
  const merged: Record<string, z.ZodType> = {};
  const sources: Record<string, string> = {};
  const kmsFields: { readonly name: string; readonly source: string }[] = [];
  const noteKms = (name: string, field: z.ZodType, source: string): void => {
    if (readKumikoMeta(field).kms === true) kmsFields.push({ name, source });
  };

  // Framework-core first so a feature that accidentally declares the same
  // var (e.g. PORT) gets a clear conflict error citing "framework-core"
  // rather than silently overwriting a deploy-critical default. The
  // conflict-detection makes the order safe in both directions — both
  // throw — but downstream tools that consume `sources` (e.g. the
  // upcoming lint-guard) may rely on this insertion order.
  if (options.core) {
    for (const [key, field] of Object.entries(zodShape(options.core))) {
      merged[key] = field;
      sources[key] = "framework-core";
      noteKms(key, field, "framework-core");
    }
  }

  const featureFields = new Map<string, z.ZodType>();
  for (const feature of options.features) {
    if (!feature.envSchema) continue;
    const wrap = optionalSet.has(feature.name);
    for (const [key, field] of Object.entries(zodShape(feature.envSchema))) {
      if (merged[key] !== undefined) {
        if (!isSharedFeatureFragment(featureFields, key, field)) {
          throw envVarConflictError(key, sources[key], feature.name);
        }
        keepStrictestOfSharedFragment(merged, key, field, wrap);
        continue;
      }
      featureFields.set(key, field);
      merged[key] = wrap ? optionalKeepingKmsMeta(field) : field;
      sources[key] = feature.name;
      noteKms(key, field, feature.name);
    }
  }

  if (options.extend) {
    for (const [key, field] of Object.entries(zodShape(options.extend))) {
      // An app spreading a feature's own fragment into extend re-declares the
      // same instance; that is the feature's variable, not a second owner.
      if (featureFields.get(key) === field) continue;
      if (merged[key] !== undefined) {
        throw new KumikoBootError([
          {
            name: key,
            kind: "invalid",
            message:
              `env-var conflict: "${key}" is declared by "${sources[key]}" and again in the app's extend block — ` +
              `drop it from extend, the declaring source already owns it.`,
          },
        ]);
      }
      merged[key] = field;
      sources[key] = "app";
      noteKms(key, field, "app");
    }
  }

  declareKmsCiphertextTwins(merged, sources, kmsFields);

  // @cast-boundary schema-walk — the loops above merge exactly the core, feature and extend shapes the type names; a key clash throws instead of overwriting.
  const schema = z.object(merged) as z.ZodObject<
    ComposedEnvShape<TFeatures, TCore, TExtend, TOptionalFeatures>
  >;
  return { schema, sources };
}

// --- Errors ---

function formatBootError(errors: readonly EnvError[]): string {
  const lines: string[] = [
    `Boot failed: ${errors.length} env-var problem${errors.length === 1 ? "" : "s"}`,
    "",
  ];
  for (const err of errors) {
    const tag = err.kind === "missing" ? "required, missing" : "invalid";
    const sourceTag = err.source ? `${err.source}, ${tag}` : tag;
    lines.push(`  ✗ ${err.name} (${sourceTag})`);
    lines.push(`    ${err.message}`);
    if (err.suggestion) {
      lines.push(`    ${err.suggestion}`);
    }
  }
  lines.push("");
  lines.push(
    "See: https://github.com/CosmicDriftGameStudio/infra/blob/main/docs/runbooks/standard-deploy-app.md#schritt-1--env-vertrag-lokal-ausgeben",
  );
  return lines.join("\n");
}

export class KumikoBootError extends Error {
  readonly errors: readonly EnvError[];

  constructor(errors: readonly EnvError[]) {
    super(formatBootError(errors));
    this.name = "KumikoBootError";
    this.errors = errors;
  }

  format(): string {
    return formatBootError(this.errors);
  }
}

// --- Parse ---
// safeParse does not catch exceptions thrown inside refinements; a refinement
// reading a ciphertext-only slot (undefined here) would otherwise escape as a raw
// TypeError past the KumikoBootError mapping.
function safeParseReportingThrows(
  schema: z.ZodObject<z.ZodRawShape>,
  input: Record<string, string>,
): ReturnType<z.ZodObject<z.ZodRawShape>["safeParse"]> {
  try {
    return schema.safeParse(input);
  } catch (error) {
    throw new KumikoBootError([
      {
        name: "<schema refinement>",
        kind: "invalid",
        message: `an env schema refinement threw: ${error instanceof Error ? error.message : String(error)}. If it reads a kms slot delivered only as <NAME>_CIPHERTEXT, the value is undefined at this point.`,
      },
    ]);
  }
}

/** Validates `env` against `schema` and throws KumikoBootError on any issue.
 *  A `kms: true` field delivered only as `<NAME>_CIPHERTEXT` passes validation but
 *  is `undefined` in the result despite its `string` type — it is only set once
 *  the boot-time decrypt (resolvePlatformKeks) has run. */
export function parseEnv<S extends z.ZodObject<z.ZodRawShape>>(
  schema: S,
  env: Record<string, string | undefined>,
  options: ParseEnvOptions = {},
): z.infer<S> {
  // Filter undefined values to keep Zod's required-vs-invalid signal clean.
  // (process.env returns string|undefined; passing undefined would parse
  // as "field is set to undefined" which clouds the missing-key heuristic.)
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) cleaned[k] = v;
  }

  const result = safeParseReportingThrows(relaxCiphertextOnlySlots(schema, cleaned), cleaned);
  if (result.success) {
    // @cast-boundary schema-walk — z.infer<S> erasure across safeParse result
    return result.data as z.infer<S>;
  }

  // Map Zod-issues → EnvError[], augmenting with suggestions when meta+prefix.
  const errors: EnvError[] = result.error.issues.map((issue) => {
    const name = String(issue.path[0] ?? "<unknown>");
    const field = zodShapeField(schema, name);
    // Zod v4 dropped the `received` property on invalid_type issues; the
    // canonical signal for "value was missing" is now "the key isn't in
    // the input object". Use input-presence as the missing/invalid switch.
    const isMissing = issue.code === "invalid_type" && !(name in cleaned);
    const kind: EnvErrorKind = isMissing ? "missing" : "invalid";
    const desc = field ? getFieldDescription(field) : undefined;
    const issueText =
      issue.code === "invalid_type" && issue.expected === "nonoptional"
        ? "Invalid input: required"
        : issue.message;
    const message = desc ? `${issueText} — ${desc}` : issueText;
    const suggestion = field ? buildPulumiSuggestion(name, field, options.pulumiPrefix) : undefined;
    const source = options.sources?.[name];
    return {
      name,
      kind,
      message,
      ...(source ? { source } : {}),
      ...(suggestion ? { suggestion } : {}),
    };
  });

  throw new KumikoBootError(errors);
}

// --- Pulumi-suggestion ---

/** Dry-run counterpart to parseEnv (KUMIKO_DRY_RUN_ENV path): parses each
 *  field individually and returns an honest Partial — present values pass
 *  through with their types (coerced), while missing or invalid values are
 *  simply omitted. Never throws: the dry run renders the inventory instead
 *  of failing on required fields. Replaces the `({} as Shape)` pattern, where
 *  every access silently returned undefined and the compiler could not detect
 *  it. */
export function parseEnvDryRun<S extends z.ZodObject<z.ZodRawShape>>(
  schema: S,
  env: Record<string, string | undefined>,
): Partial<z.infer<S>> {
  const out: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(zodShape(schema))) {
    const raw = env[name];
    if (raw === undefined) continue;
    const result = field.safeParse(raw);
    if (result.success) out[name] = result.data;
  }
  // @cast-boundary schema-walk — Partial<z.infer<S>> erasure through the
  // per-field safeParse; every included value passed its field-level parse.
  return out as Partial<z.infer<S>>;
}

export type EnvFieldInspection = {
  readonly name: string;
  readonly klass: EnvFieldClass;
  readonly source: string;
  readonly status: EnvFieldStatus;
  /** Zod's issue text for an invalid value; never the value itself. */
  readonly message?: string;
};

/** Checks every field of `schema` on its own against `env`, for the boot dry
 *  run: a missing required value is reported, not thrown, so the inventory
 *  renders on an empty env. Object-level refinements do not run here; once
 *  nothing is missing or invalid, parseEnv validates the whole object. */
export function inspectEnv(
  schema: z.ZodObject<z.ZodRawShape>,
  env: Readonly<Record<string, string | undefined>>,
  options: Pick<ParseEnvOptions, "sources"> = {},
): readonly EnvFieldInspection[] {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) cleaned[k] = v;
  }
  const relaxed = relaxCiphertextOnlySlots(schema, cleaned);
  return Object.entries(zodShape(relaxed)).map(([name, field]): EnvFieldInspection => {
    const klass = classifyField(field);
    const source = options.sources?.[name] ?? "unknown";
    const raw = cleaned[name];
    if (raw === undefined) {
      return { name, klass, source, status: klass === "required" ? "missing" : "unset" };
    }
    const issue = firstFieldIssue(field, raw);
    return issue === undefined
      ? { name, klass, source, status: "set" }
      : { name, klass, source, status: "invalid", message: issue };
  });
}

function firstFieldIssue(field: z.ZodType, raw: string): string | undefined {
  try {
    const result = field.safeParse(raw);
    if (result.success) return undefined;
    const message = result.error.issues[0]?.message ?? "invalid value";
    // A custom refine message may interpolate the input; the table must not
    // carry it, so such a message is replaced as a whole.
    return raw.length > 0 && message.includes(raw) ? "invalid value" : message;
  } catch {
    // The thrown message may quote the value, so it is not passed on.
    return "a field refinement threw while checking the value";
  }
}
