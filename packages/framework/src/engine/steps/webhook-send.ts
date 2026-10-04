// r.step.webhook.send — deferred HTTP-POST via the step-dispatcher.
// Tier-2: requires `r.requires.step("webhook.send")` in the owning feature.
//
// Writes a `kumiko:step:dispatch-requested` event onto a fresh step-dispatch
// stream in the current TX. The step-dispatcher subscription (bundled-feature
// `step-dispatcher`) reads after COMMIT and performs one fetch per request;
// a repeat only happens when the consumer redelivers the event, under the
// same Idempotency-Key.

import { randomUUID } from "node:crypto";
import { defineStep } from "../define-step.js";
import type { PipelineCtx, StepInstance, StepResolver } from "../types/step.js";
import { resolveOptional, resolveRequired } from "./_resolver-utils.js";
import {
  STEP_DISPATCH_AGGREGATE_TYPE,
  STEP_DISPATCH_REQUESTED_TYPE,
} from "./_step-dispatch-constants.js";

type WebhookHttpMethod = "POST" | "PUT" | "PATCH";

// Name inside the tenant-owned secrets namespace
// `step-dispatcher:webhook-auth.<secret>` (secrets feature).
type WebhookAuth =
  | { readonly kind: "bearer"; readonly secret: string }
  | { readonly kind: "header"; readonly name: string; readonly secret: string };

type WebhookSendArgs = {
  readonly url: StepResolver<string>;
  readonly method?: WebhookHttpMethod;
  readonly headers?: StepResolver<Readonly<Record<string, string>>>;
  readonly body?: StepResolver<unknown>;
  readonly auth?: WebhookAuth;
  readonly mode: "deferred";
};

defineStep<WebhookSendArgs, void>({
  kind: "webhook.send",
  tier: 2,
  defaultFailureStrategy: "throw",
  run: async (args, ctx: PipelineCtx) => {
    const url = resolveRequired(args.url, ctx);
    const headers = resolveOptional(args.headers, ctx) ?? {};
    const body = resolveOptional(args.body, ctx);
    await ctx.unsafeAppendEvent({
      aggregateId: randomUUID(),
      aggregateType: STEP_DISPATCH_AGGREGATE_TYPE,
      type: STEP_DISPATCH_REQUESTED_TYPE,
      payload: {
        stepKind: "webhook.send",
        // Flat string fields: event PII encryption only handles top-level strings.
        url,
        method: args.method ?? "POST",
        headersJson: JSON.stringify(headers),
        ...(body !== undefined && { bodyJson: JSON.stringify(body) }),
        ...(args.auth && { auth: args.auth }),
      },
    });
  },
});

export function buildWebhookSendStep(args: WebhookSendArgs): StepInstance {
  return { kind: "webhook.send", args };
}
