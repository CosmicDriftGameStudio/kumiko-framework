// reads the { escapeHatch: { reason } } convention off a
// `r.useExtension(...)` registration's untyped options bag. Registration-time
// validation (feature-ui-extensions.ts's useExtension) already rejects an
// empty reason, but options stays `Record<string, unknown>`, so orchestrators
// re-narrow at read time instead of trusting the shape.

import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { reasonProblem } from "../escape-hatch-reason.ts";
import type { RegistrarExtensionRegistration } from "../types/config.ts";

export function extensionUsageEscapeHatchReason(
  usage: Pick<RegistrarExtensionRegistration, "options">,
): string | undefined {
  const escapeHatch = usage.options?.["escapeHatch"];
  if (!isPlainObject(escapeHatch)) return undefined;
  const { reason, grants } = escapeHatch;
  if (Array.isArray(grants) && !grants.includes("unsafeRaw")) return undefined;
  return typeof reason === "string" && reasonProblem(reason) === undefined ? reason : undefined;
}
