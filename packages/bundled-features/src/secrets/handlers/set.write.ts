import { defineWriteHandler } from "@kumiko/framework/engine";
import { z } from "zod";
import { requireSecretsContext } from "../secrets-feature";

export const setWrite = defineWriteHandler({
  name: "set",
  schema: z.object({
    key: z.string().min(1).max(100),
    value: z.string(),
    // Optional fixed-length preview — if the caller's UI wants a domain-
    // specific redaction ("sk_live_abc…xyz") it can send it here; else the
    // handler derives a generic one (first-3-chars + bullets).
    redactedPreview: z.string().max(50).optional(),
    hint: z.string().max(200).optional(),
  }),
  access: { roles: ["TenantAdmin"] },
  handler: async (event, ctx) => {
    const secrets = requireSecretsContext(ctx, "secrets:write:set");
    const { key, value, redactedPreview, hint } = event.payload;

    // Preview-priority: explicit payload param > feature-declared redact
    // (via r.secret()) > generic default. A feature that declared a
    // domain-aware redact (Stripe keys: "sk_test...2345") wins over the
    // framework default unless the caller sent a specific preview.
    const keyDef = ctx.registry.getSecretKey(key);
    const featureRedact = keyDef?.redact;
    const redactFn: (v: string) => string = redactedPreview
      ? () => redactedPreview
      : (featureRedact ?? defaultRedact);

    await secrets.set(event.user.tenantId, key, value, {
      redact: redactFn,
      ...(hint ? { hint } : {}),
      updatedBy: event.user.id,
    });

    return {
      isSuccess: true,
      data: { key, redactedPreview: redactedPreview ?? redactFn(value) },
    };
  },
});

// Fallback redaction: show at most the first 3 chars + trailing bullets.
// Deliberately conservative — a too-generous preview defeats the point.
function defaultRedact(value: string): string {
  if (value.length === 0) return "";
  const prefix = value.slice(0, Math.min(3, value.length));
  return `${prefix}${"•".repeat(Math.max(1, value.length - 3))}`;
}
