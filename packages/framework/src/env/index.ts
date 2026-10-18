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
import type { FeatureDefinition } from "../engine/types/feature.js";
import { zodDef, zodDescription, zodMeta, zodShape, zodShapeField } from "./_zod-introspect.js";

// --- Per-env-var metadata (attach via Zod's `.meta()`) ---

export type KumikoEnvMeta = {
  readonly pulumi?: {
    /** Override the auto-derived camelCase Pulumi-config-key name. Apps
     *  setting `pulumiPrefix: "studio"` and authoring `STUDIO_ADMIN_EMAIL`
     *  would otherwise get `studioStudioAdminEmail` — set
     *  `.meta({ kumiko: { pulumi: { name: "adminEmail" } } })` to drop the
     *  duplicated prefix. */
    readonly name?: string;
    /** Shell expression that generates a value, e.g. `openssl rand -base64 32`.
     *  Without this, dry-run-pulumi emits `<set-me>` as the placeholder. */
    readonly generator?: string;
    /** Force the `--secret` flag in `pulumi config set`. Default false. */
    readonly secret?: boolean;
  };
  /** The value may be delivered as a Scaleway Key Manager ciphertext in
   *  `<NAME>_CIPHERTEXT`. `runProdApp` decrypts it at boot when `<NAME>` itself
   *  is unset; a set plaintext always wins. A flag, not an object: every slot
   *  uses the same `_CIPHERTEXT` twin and one shared key (`PLATFORM_KEK_KMS_*`). */
  readonly kms?: true;
};

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

export type EnvFieldClass = "required" | "optional" | "withDefault";

export function classifyField(field: z.ZodType): EnvFieldClass {
  // Drill through ZodEffects/ZodPipe wrappers to find the inner kind.
  let current: z.ZodType = field;
  for (let i = 0; i < 8; i++) {
    if (current instanceof z.ZodDefault) return "withDefault";
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

export function getDefaultValue(field: z.ZodType): unknown {
  let current: z.ZodType = field;
  for (let i = 0; i < 8; i++) {
    if (current instanceof z.ZodDefault) {
      // Zod v4: defaultValue is the raw value (v3 was a factory function).
      // Support both shapes for forward/backward safety.
      const raw = zodDef(current)?.defaultValue;
      // @cast-boundary schema-walk — Zod v3 stored a thunk, v4 a raw value
      return typeof raw === "function" ? (raw as () => unknown)() : raw;
    }
    const inner = zodDef(current);
    if (inner?.innerType) {
      current = inner.innerType;
      continue;
    }
    break;
  }
  return undefined;
}

// @wrapper-known semantic-alias
export function getFieldDescription(field: z.ZodType): string | undefined {
  return zodDescription(field);
}

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
type EmptyShape = Record<never, never>;

type DeclaredEnvShape<TFeature> = TFeature extends {
  readonly envSchema: z.ZodObject<infer TShape extends z.ZodRawShape>;
}
  ? string extends keyof TShape
    ? EmptyShape
    : TShape
  : EmptyShape;

type UnionToIntersection<TUnion> = (
  TUnion extends unknown
    ? (value: TUnion) => void
    : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never;

type OptionalShape<TShape extends z.ZodRawShape> = {
  [Key in keyof TShape]: z.ZodOptional<TShape[Key]>;
};

type FeaturesEnvShape<TFeatures extends readonly FeatureDefinition[]> = UnionToIntersection<
  DeclaredEnvShape<TFeatures[number]>
>;

type FlattenShape<TShape> = { [Key in keyof TShape]: TShape[Key] } & {};

type KnownShape<TShape extends z.ZodRawShape> = string extends keyof TShape ? EmptyShape : TShape;

/** The merged shape `composeEnvSchema` returns. With `optionalFeatures`
 *  every feature field is typed optional: the type cannot tell which feature
 *  a name refers to, and over-reporting `undefined` is the safe side. */
export type ComposedEnvShape<
  TFeatures extends readonly FeatureDefinition[],
  TCore extends z.ZodRawShape,
  TExtend extends z.ZodRawShape,
  TOptionalFeatures extends readonly string[] | undefined,
> = Extract<
  FlattenShape<
    KnownShape<TCore> &
      (TOptionalFeatures extends readonly string[]
        ? OptionalShape<FeaturesEnvShape<TFeatures> & z.ZodRawShape>
        : FeaturesEnvShape<TFeatures>) &
      KnownShape<TExtend>
  >,
  z.ZodRawShape
>;

// --- Compose ---

export type ComposeEnvSchemaOptions<
  TFeatures extends readonly FeatureDefinition[] = readonly FeatureDefinition[],
  TCore extends z.ZodRawShape = z.ZodRawShape,
  TExtend extends z.ZodRawShape = z.ZodRawShape,
  TOptionalFeatures extends readonly string[] | undefined = readonly string[] | undefined,
> = {
  /** All features whose envSchemas should be merged. Bundled features type
   *  their fragment, so passing the list inline types the merged schema. */
  readonly features: TFeatures;
  /** App-specific env-vars (e.g. `STUDIO_ADMIN_EMAIL`). Keys here are
   *  tagged as source "app" in the resulting sources map. */
  readonly extend?: z.ZodObject<TExtend>;
  /** Feature-names whose env-vars should be auto-`.optional()`-wrapped.
   *  Lets an app opt out of e.g. `channel-email-smtp`'s vars without
   *  manually `.partial()`-ing each shape at the call-site. */
  readonly optionalFeatures?: TOptionalFeatures;
  /** Framework-core env-vars (PORT, DATABASE_URL, REDIS_URL, …) from
   *  `@cosmicdrift/kumiko-dev-server`. Keys here are tagged as source
   *  "framework-core" in error output. Conflict-detection runs across
   *  core/features/extend as one merged pool — same key declared in two
   *  layers throws KumikoBootError at compose-time. */
  readonly core?: z.ZodObject<TCore>;
};

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
  // upcoming Phase-5 lint-guard) may rely on this insertion order.
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

  return {
    // @cast-boundary schema-walk — the loops above merge exactly the core, feature and extend shapes the type names; a key clash throws instead of overwriting.
    schema: z.object(merged) as z.ZodObject<
      ComposedEnvShape<TFeatures, TCore, TExtend, TOptionalFeatures>
    >,
    sources,
  };
}

// --- Errors ---

export type EnvErrorKind = "missing" | "invalid";

export type EnvError = {
  readonly name: string;
  readonly kind: EnvErrorKind;
  readonly message: string;
  /** Declaring source-name from `composeEnvSchema`'s sources map:
   *  feature-name, "app" from `extend`, or "framework-core" from `core`.
   *  Populated when parseEnv received `options.sources`. Surfaced by
   *  `KumikoBootError.format()` so operators see WHICH source wants the
   *  missing var, not just the var name. */
  readonly source?: string;
  /** "Set via: pulumi config set ..." line. Computed when pulumiPrefix is
   *  passed to parseEnv. */
  readonly suggestion?: string;
};

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
  lines.push("See: kumiko-platform/docs/runbooks/standard-deploy-app.md#step-1-boot-dry-run-lokal");
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

export type ParseEnvOptions = {
  /** From composeEnvSchema's return — enables per-var feature-source
   *  attribution in suggestions. */
  readonly sources?: Readonly<Record<string, string>>;
  /** When set, error suggestions include `pulumi config set <prefix>...`. */
  readonly pulumiPrefix?: string;
};

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
    const message = desc ? `${issue.message} — ${desc}` : issue.message;
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

function ucfirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** Dry-Run-Gegenstück zu parseEnv (KUMIKO_DRY_RUN_ENV-Pfad): parst jedes
 *  Feld einzeln und liefert ein ehrliches Partial — vorhandene Werte kommen
 *  typisiert (gecoerct) durch, fehlende/invalide fehlen einfach. Wirft nie:
 *  der Dry-Run soll das Inventory rendern, nicht an required-Feldern
 *  scheitern. Ersetzt das `({} as Shape)`-Muster, bei dem JEDER Zugriff
 *  silent undefined war und das Compile-Level nichts davon wusste. */
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
  // @cast-boundary schema-walk — Partial<z.infer<S>> erasure über den
  // per-Feld-safeParse; jeder enthaltene Wert hat seinen Feld-Parse bestanden.
  return out as Partial<z.infer<S>>;
}

export function camelCase(snakeShout: string): string {
  const parts = snakeShout.toLowerCase().split("_").filter(Boolean);
  if (parts.length === 0) return snakeShout.toLowerCase();
  return parts[0] + parts.slice(1).map(ucfirst).join("");
}

export function pulumiConfigKey(
  envName: string,
  field: z.ZodType | undefined,
  prefix: string | undefined,
): string {
  const meta = field ? readKumikoMeta(field) : {};
  if (meta.pulumi?.name) {
    return prefix ? prefix + ucfirst(meta.pulumi.name) : meta.pulumi.name;
  }
  const camel = camelCase(envName);
  return prefix ? prefix + ucfirst(camel) : camel;
}

export function buildPulumiSuggestion(
  envName: string,
  field: z.ZodType,
  prefix: string | undefined,
): string | undefined {
  if (!prefix) return undefined;
  const meta = readKumikoMeta(field);
  const key = pulumiConfigKey(envName, field, prefix);
  const secretFlag = meta.pulumi?.secret ? " --secret" : "";
  const value = meta.pulumi?.generator ? `"$(${meta.pulumi.generator})"` : `"<set-me>"`;
  return `Set via: pulumi config set${secretFlag} ${key} ${value}`;
}
