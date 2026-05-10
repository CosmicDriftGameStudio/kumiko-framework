// r.step.webhook.send — deferred HTTP-POST via the step-dispatcher.
// Tier-2: requires `r.requires.step("webhook.send")` in the owning feature.
//
// Writes a `kumiko:step:dispatch-requested` event onto a fresh step-dispatch
// stream in the current TX. The step-dispatcher subscription (bundled-feature
// `step-dispatcher`) reads after COMMIT and performs the fetch with retry.

import { randomUUID } from "node:crypto";
import { defineStep } from "../define-step";
import type { PipelineCtx, StepInstance, StepResolver } from "../types/step";
import { resolveOptional, resolveRequired } from "./_resolver-utils";
import {
  STEP_DISPATCH_AGGREGATE_TYPE,
  STEP_DISPATCH_REQUESTED_TYPE,
} from "./_step-dispatch-constants";

// Re-export for back-compat callers (bundled step-dispatcher imports
// these). The canonical home is _step-dispatch-constants.ts.
export {
  STEP_DISPATCH_AGGREGATE_TYPE,
  STEP_DISPATCH_FAILED_TYPE,
  STEP_DISPATCH_REQUESTED_TYPE,
  STEP_DISPATCHED_TYPE,
} from "./_step-dispatch-constants";

type WebhookHttpMethod = "POST" | "PUT" | "PATCH";

type WebhookAuth =
  | { readonly kind: "bearer"; readonly secretRef: string }
  | { readonly kind: "header"; readonly name: string; readonly secretRef: string };

type WebhookSendArgs = {
  readonly url: StepResolver<string>;
  readonly method?: WebhookHttpMethod;
  readonly headers?: StepResolver<Readonly<Record<string, string>>>;
  readonly body?: StepResolver<unknown>;
  readonly auth?: WebhookAuth;
  readonly mode: "deferred";
  readonly retry?: { readonly times: number; readonly backoff: "exponential" | "linear" };
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
        spec: {
          url,
          method: args.method ?? "POST",
          headers,
          body,
          ...(args.auth && { auth: args.auth }),
        },
        retry: args.retry ?? { times: 3, backoff: "exponential" },
      },
    });
  },
});

export function buildWebhookSendStep(args: WebhookSendArgs): StepInstance {
  return { kind: "webhook.send", args };
}
