import * as z from "zod";
import type { FeatureDefinition } from "../engine/types/feature.ts";
import { zodDef, zodDescription } from "./_zod-introspect.ts";
import { readKumikoMeta } from "./index.ts";

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

// --- Field-classification helpers (Zod v4 introspection) ---
export type EnvFieldClass = "required" | "optional" | "withDefault";

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

// A feature typed as plain FeatureDefinition carries `ZodRawShape`, whose
// index signature would swallow every typed key of the intersection.
export type EmptyShape = Record<never, never>;

export type DeclaredEnvShape<TFeature> = TFeature extends {
  readonly envSchema: z.ZodObject<infer TShape extends z.ZodRawShape>;
}
  ? string extends keyof TShape
    ? EmptyShape
    : TShape
  : EmptyShape;

export type UnionToIntersection<TUnion> = (
  TUnion extends unknown
    ? (value: TUnion) => void
    : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never;

export type OptionalShape<TShape extends z.ZodRawShape> = {
  [Key in keyof TShape]: z.ZodOptional<TShape[Key]>;
};

export type FeaturesEnvShape<TFeatures extends readonly FeatureDefinition[]> = UnionToIntersection<
  DeclaredEnvShape<TFeatures[number]>
>;

export type FlattenShape<TShape> = { [Key in keyof TShape]: TShape[Key] } & {};

export type KnownShape<TShape extends z.ZodRawShape> = string extends keyof TShape
  ? EmptyShape
  : TShape;

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

// --- Parse ---
export type ParseEnvOptions = {
  /** From composeEnvSchema's return — enables per-var feature-source
   *  attribution in suggestions. */
  readonly sources?: Readonly<Record<string, string>>;
  /** When set, error suggestions include `pulumi config set <prefix>...`. */
  readonly pulumiPrefix?: string;
};

// --- Pulumi-suggestion ---
export function ucfirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

export type EnvFieldStatus = "set" | "unset" | "missing" | "invalid";

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
