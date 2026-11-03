import type * as z from "zod";
import { zodMeta, zodShape } from "./_zod-introspect.ts";

/** Cross-variable rule on one env field: gets the field's raw value and the whole env being
 *  booted (so `NODE_ENV` comes from the injected source, not `process.env`), returns a message
 *  when the value is unacceptable. Attach via `.meta({ kumiko: { envRule } })`. */
export type EnvFieldRule = (
  value: string,
  env: Readonly<Record<string, string | undefined>>,
) => string | undefined;

function isEnvFieldRule(value: unknown): value is EnvFieldRule {
  return typeof value === "function";
}

function envRuleOf(field: z.ZodType): EnvFieldRule | undefined {
  const meta = zodMeta(field);
  if (typeof meta !== "object" || meta === null || !("kumiko" in meta)) return undefined;
  const kumiko = meta.kumiko;
  if (typeof kumiko !== "object" || kumiko === null || !("envRule" in kumiko)) return undefined;
  return isEnvFieldRule(kumiko.envRule) ? kumiko.envRule : undefined;
}

/** Rule message for one set field; undefined when the field has no rule or the value passes. */
export function envRuleViolation(
  field: z.ZodType,
  value: string,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return envRuleOf(field)?.(value, env);
}

/** Field name to rule message for every set field whose rule rejects it. */
export function envRuleViolations(
  schema: z.ZodObject<z.ZodRawShape>,
  env: Readonly<Record<string, string | undefined>>,
): ReadonlyMap<string, string> {
  const violations = new Map<string, string>();
  for (const [name, field] of Object.entries(zodShape(schema))) {
    const value = env[name];
    if (value === undefined) continue;
    const message = envRuleViolation(field, value, env);
    if (message !== undefined) violations.set(name, message);
  }
  return violations;
}
