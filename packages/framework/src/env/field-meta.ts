import * as z from "zod";
import { zodDef, zodMeta } from "./_zod-introspect.ts";
import type { EnvFieldClass, KumikoEnvMeta } from "./internals.ts";

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
