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

import { z } from "zod";
import type { FeatureDefinition } from "../engine/types/feature";
import { zodDef, zodDescription, zodMeta, zodShape, zodShapeField } from "./_zod-introspect";

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
};

function isKumikoMeta(value: unknown): value is KumikoEnvMeta {
  if (value === null || typeof value !== "object") return false;
  // @cast-boundary schema-walk — runtime-shape narrowing of zod-meta payload
  const v = value as { pulumi?: unknown };
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

export function getFieldDescription(field: z.ZodType): string | undefined {
  return zodDescription(field);
}

// --- Compose ---

export type ComposeEnvSchemaOptions = {
  /** All features whose envSchemas should be merged. */
  readonly features: readonly FeatureDefinition[];
  /** App-specific env-vars (e.g. `STUDIO_ADMIN_EMAIL`). Keys here are
   *  tagged as source "app" in the resulting sources map. */
  readonly extend?: z.ZodObject<z.ZodRawShape>;
  /** Feature-names whose env-vars should be auto-`.optional()`-wrapped.
   *  Lets an app opt out of e.g. `channel-email-smtp`'s vars without
   *  manually `.partial()`-ing each shape at the call-site. */
  readonly optionalFeatures?: readonly string[];
};

export type ComposedEnvSchema = {
  /** The merged Zod schema. Type-erased to `ZodObject<ZodRawShape>` — TS
   *  can't variadic-merge N generic feature schemas without tuple gymnastics
   *  that hurt readability. For type-safe `z.infer` in app code, build a
   *  parallel typed schema manually (see Plan-Doc
   *  `kumiko-studio/docs/plans/sprint-9-env-schemas.md` → API-Design)
   *  and only pass `composed.schema` to `runProdApp` for validation. */
  readonly schema: z.ZodObject<z.ZodRawShape>;
  /** env-var-name → declaring feature-name (or "app" when from `extend`). */
  readonly sources: Readonly<Record<string, string>>;
};

export function composeEnvSchema(options: ComposeEnvSchemaOptions): ComposedEnvSchema {
  const optionalSet = new Set(options.optionalFeatures ?? []);
  const merged: Record<string, z.ZodType> = {};
  const sources: Record<string, string> = {};

  for (const feature of options.features) {
    if (!feature.envSchema) continue;
    const shape = zodShape(feature.envSchema);
    const wrap = optionalSet.has(feature.name);
    for (const [key, field] of Object.entries(shape)) {
      if (merged[key] !== undefined) {
        throw new KumikoBootError([
          {
            name: key,
            kind: "invalid",
            message:
              `env-var conflict: "${key}" declared by both ` +
              `"${sources[key]}" and "${feature.name}" — pick one owner.`,
          },
        ]);
      }
      merged[key] = wrap ? field.optional() : field;
      sources[key] = feature.name;
    }
  }

  if (options.extend) {
    for (const [key, field] of Object.entries(zodShape(options.extend))) {
      if (merged[key] !== undefined) {
        throw new KumikoBootError([
          {
            name: key,
            kind: "invalid",
            message:
              `env-var conflict: "${key}" declared by both feature ` +
              `"${sources[key]}" and the app's extend block — rename one.`,
          },
        ]);
      }
      merged[key] = field;
      sources[key] = "app";
    }
  }

  return {
    schema: z.object(merged),
    sources,
  };
}

// --- Errors ---

export type EnvErrorKind = "missing" | "invalid";

export type EnvError = {
  readonly name: string;
  readonly kind: EnvErrorKind;
  readonly message: string;
  /** Declaring feature-name from `composeEnvSchema`'s sources map (or "app"
   *  if from `extend`). Populated when parseEnv received `options.sources`.
   *  Surfaced by `KumikoBootError.format()` so operators see WHICH feature
   *  wants the missing var, not just the var name. */
  readonly source?: string;
  /** "Set via: pulumi config set ..." line. Computed when pulumiPrefix is
   *  passed to parseEnv. */
  readonly suggestion?: string;
};

export class KumikoBootError extends Error {
  readonly errors: readonly EnvError[];

  constructor(errors: readonly EnvError[]) {
    super(`Boot failed: ${errors.length} env-var problem${errors.length === 1 ? "" : "s"}`);
    this.name = "KumikoBootError";
    this.errors = errors;
  }

  format(): string {
    const lines: string[] = [
      `Boot failed: ${this.errors.length} env-var problem${this.errors.length === 1 ? "" : "s"}`,
      "",
    ];
    for (const err of this.errors) {
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
      "See: kumiko-platform/docs/runbooks/standard-deploy-app.md#step-1-boot-dry-run-lokal",
    );
    return lines.join("\n");
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

  const result = schema.safeParse(cleaned);
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
