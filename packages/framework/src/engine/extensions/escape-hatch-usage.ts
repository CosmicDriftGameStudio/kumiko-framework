// fw#2914 — reads the { escapeHatch: { reason } } convention off a
// `r.useExtension(...)` registration's untyped options bag. Registration-time
// validation (feature-ui-extensions.ts's useExtension) already rejects an
// empty reason, but options stays `Record<string, unknown>`, so orchestrators
// re-narrow at read time instead of trusting the shape.

import type { RegistrarExtensionRegistration } from "../types/config";

export function extensionUsageEscapeHatchReason(
  usage: Pick<RegistrarExtensionRegistration, "options">,
): string | undefined {
  const escapeHatch = usage.options?.["escapeHatch"];
  if (typeof escapeHatch !== "object" || escapeHatch === null) return undefined;
  const reason = (escapeHatch as { reason?: unknown }).reason;
  return typeof reason === "string" && reason.trim().length > 0 ? reason : undefined;
}
