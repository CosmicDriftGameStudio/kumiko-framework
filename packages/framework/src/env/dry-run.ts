// Renderers for `KUMIKO_DRY_RUN_ENV=<mode>`. Operators run this against
// a built app to discover the required env-vars without booting:
//   - `human` — tabular, grouped by required/optional/withDefault
//   - `json`  — machine-readable for CI / tooling
//   - `pulumi`— `pulumi config set …`-lines for bootstrap
//   - `k8s`   — Secret YAML stub
//
// The same schema introspection (`classifyField`, `readKumikoMeta`) used
// by parseEnv drives the output here — single source of truth.

import type { z } from "zod";
import {
  type ComposedEnvSchema,
  classifyField,
  type EnvFieldClass,
  getDefaultValue,
  getFieldDescription,
  pulumiConfigKey,
  readKumikoMeta,
} from "./index";

export type DryRunMode = "human" | "json" | "pulumi" | "k8s";

export type DryRunOptions = {
  /** From composeEnvSchema. Drives the per-row feature-attribution. */
  readonly sources?: Readonly<Record<string, string>>;
  /** Prefix for `pulumi config set <prefix>…` keys. Default "". */
  readonly pulumiPrefix?: string;
  /** k8s Secret name. Default "kumiko-env". */
  readonly k8sName?: string;
  /** k8s namespace. Default "default". */
  readonly k8sNamespace?: string;
};

type EnvField = {
  readonly name: string;
  readonly field: z.ZodType;
  readonly klass: EnvFieldClass;
  readonly description?: string;
  readonly defaultValue?: unknown;
  readonly source: string; // feature name or "app" or "unknown"
};

function collectFields(
  schema: z.ZodObject<z.ZodRawShape>,
  sources: Readonly<Record<string, string>>,
): readonly EnvField[] {
  const out: EnvField[] = [];
  // Cast at the boundary — Zod v4 typing exposes `shape` values as $ZodType
  // (core) but the helpers consume ZodType (wrapper class); same runtime
  // instance.
  for (const [name, field] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
    const f = field;
    const klass = classifyField(f);
    out.push({
      name,
      field: f,
      klass,
      description: getFieldDescription(f),
      ...(klass === "withDefault" ? { defaultValue: getDefaultValue(f) } : {}),
      source: sources[name] ?? "unknown",
    });
  }
  // Sort by class (required first), then by source, then by name. Stable
  // ordering matters for snapshot-tests + grep-ability.
  const order: Record<EnvFieldClass, number> = {
    required: 0,
    optional: 1,
    withDefault: 2,
  };
  return out.sort((a, b) => {
    if (order[a.klass] !== order[b.klass]) return order[a.klass] - order[b.klass];
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.name.localeCompare(b.name);
  });
}

export function renderDryRun(
  composed: ComposedEnvSchema,
  mode: DryRunMode,
  options: DryRunOptions = {},
): string {
  const sources = options.sources ?? composed.sources;
  const fields = collectFields(composed.schema, sources);
  switch (mode) {
    case "human":
      return renderHuman(fields);
    case "json":
      return renderJson(fields, options);
    case "pulumi":
      return renderPulumi(fields, options);
    case "k8s":
      return renderK8s(fields, options);
  }
}

function renderHuman(fields: readonly EnvField[]): string {
  const grouped: Record<EnvFieldClass, EnvField[]> = {
    required: [],
    optional: [],
    withDefault: [],
  };
  for (const f of fields) grouped[f.klass].push(f);

  const lines: string[] = [];
  const sectionTitle: Record<EnvFieldClass, string> = {
    required: "Required env-vars:",
    optional: "Optional env-vars:",
    withDefault: "Defaulted env-vars:",
  };
  const longest = fields.reduce((m, f) => Math.max(m, f.name.length), 0);
  let first = true;
  for (const klass of ["required", "optional", "withDefault"] as const) {
    const items = grouped[klass];
    if (items.length === 0) continue;
    if (!first) lines.push("");
    first = false;
    lines.push(sectionTitle[klass]);
    for (const f of items) {
      const padded = f.name.padEnd(longest, " ");
      const src = `(${f.source})`;
      const dflt =
        f.klass === "withDefault" && f.defaultValue !== undefined
          ? ` [default: ${JSON.stringify(f.defaultValue)}]`
          : "";
      const desc = f.description ? ` — ${f.description}` : "";
      lines.push(`  ${padded}  ${src}${dflt}${desc}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderJson(fields: readonly EnvField[], options: DryRunOptions): string {
  const required = fields.filter((f) => f.klass === "required");
  const optional = fields.filter((f) => f.klass === "optional");
  const withDefault = fields.filter((f) => f.klass === "withDefault");

  const toEntry = (f: EnvField) => ({
    name: f.name,
    feature: f.source,
    ...(f.description ? { description: f.description } : {}),
    ...(f.defaultValue !== undefined ? { default: f.defaultValue } : {}),
    pulumiName: pulumiConfigKey(f.name, f.field, options.pulumiPrefix),
  });

  return `${JSON.stringify(
    {
      required: required.map(toEntry),
      optional: optional.map(toEntry),
      withDefault: withDefault.map(toEntry),
    },
    null,
    2,
  )}\n`;
}

function renderPulumi(fields: readonly EnvField[], options: DryRunOptions): string {
  // Defaulted vars are skipped — the framework provides them, ops doesn't.
  const lines: string[] = [];
  for (const f of fields) {
    if (f.klass === "withDefault") continue;
    if (f.klass === "optional") continue;
    const meta = readKumikoMeta(f.field);
    const key = pulumiConfigKey(f.name, f.field, options.pulumiPrefix);
    const secretFlag = meta.pulumi?.secret ? " --secret" : "";
    const value = meta.pulumi?.generator ? `"$(${meta.pulumi.generator})"` : `"<set-me>"`;
    const comment = f.description
      ? ` # ${f.name} (${f.source}): ${f.description}`
      : ` # ${f.name} (${f.source})`;
    lines.push(`pulumi config set${secretFlag} ${key} ${value}${comment}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderK8s(fields: readonly EnvField[], options: DryRunOptions): string {
  const name = options.k8sName ?? "kumiko-env";
  const namespace = options.k8sNamespace ?? "default";
  const lines: string[] = [
    "apiVersion: v1",
    "kind: Secret",
    "metadata:",
    `  name: ${name}`,
    `  namespace: ${namespace}`,
    "type: Opaque",
    "stringData:",
  ];
  for (const f of fields) {
    if (f.klass === "withDefault") continue;
    if (f.klass === "optional") continue;
    lines.push(`  ${f.name}: "<set-me>"`);
  }
  return `${lines.join("\n")}\n`;
}
