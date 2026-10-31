import { type AccessRule, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { announceSecretChange } from "../announce-secret-change.ts";
import { JOIN_REQUEST_TRANSACTION_REASON, requireSecretsContext } from "../feature.ts";
import { resolveSecretTarget, secretScopeSchema } from "../secret-scope.ts";
import { DEFAULT_SECRETS_ACCESS, SecretsHandlers } from "../web/constants.ts";
import { checkSecretKeyWrite, checkSecretValue } from "../write-gate.ts";

export function createSetHandler(access: AccessRule = DEFAULT_SECRETS_ACCESS) {
  return defineWriteHandler({
    name: "set",
    description:
      "Stores or replaces one encrypted secret for the caller's tenant (or, with scope system and the SystemAdmin role, the platform-wide one) under the given key, together with a redacted preview and optional hint; use it to enter or rotate a credential.",
    // `value` is the plaintext credential: as a tool call it would travel to
    // the model provider before it is ever encrypted at rest.
    agent: { expose: false },
    schema: z.object({
      key: z.string().min(1).max(100),
      value: z.string(),
      // Optional fixed-length preview — if the caller's UI wants a domain-
      // specific redaction ("sk_live_abc…xyz") it can send it here; else the
      // handler derives a generic one (first-3-chars + bullets).
      redactedPreview: z.string().max(50).optional(),
      hint: z.string().max(200).optional(),
      scope: secretScopeSchema,
    }),
    access,
    escapeHatch: { grants: ["unsafeRaw"], reason: JOIN_REQUEST_TRANSACTION_REASON },
    handler: async (event, ctx) => {
      const secrets = requireSecretsContext(
        { secrets: ctx.services.secrets, user: ctx.user },
        SecretsHandlers.set,
      ).withRunner(ctx.db.unsafeRaw());
      const { key, value, redactedPreview, hint, scope } = event.payload;
      const target = resolveSecretTarget(event.user, scope);
      if (!target.ok) return writeFailure(target.error);

      // Preview-priority: explicit payload param > feature-declared redact
      // (via r.secret()) > generic default. A feature that declared a
      // domain-aware redact (Stripe keys: "sk_test...2345") wins over the
      // framework default unless the caller sent a specific preview.
      const gate = checkSecretKeyWrite(ctx.registry, event.user.roles, key);
      if (!gate.ok) return gate.failure;
      const invalidValue = checkSecretValue(ctx.registry, key, value);
      if (invalidValue) return invalidValue;
      const featureRedact = gate.keyDef?.redact;
      const redactFn: (v: string) => string = redactedPreview
        ? () => redactedPreview
        : (featureRedact ?? defaultRedact);

      await secrets.set(target.tenantId, key, value, {
        redact: redactFn,
        ...(hint ? { hint } : {}),
        updatedBy: event.user.id,
      });
      announceSecretChange(ctx, target.tenantId, key);

      return {
        isSuccess: true,
        data: { key, redactedPreview: redactedPreview ?? redactFn(value) },
      };
    },
  });
}

// Fallback redaction: show at most the first 3 chars + trailing bullets.
// Deliberately conservative — a too-generous preview defeats the point.
function defaultRedact(value: string): string {
  if (value.length === 0) return "";
  const prefix = value.slice(0, Math.min(3, value.length));
  return `${prefix}${"•".repeat(Math.max(1, value.length - 3))}`;
}
