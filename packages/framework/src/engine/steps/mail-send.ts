// r.step.mail.send — deferred transactional e-mail via the step-dispatcher.
// Tier-2: requires r.requires.step("mail.send"). Mirrors webhook.send.

import { randomUUID } from "node:crypto";
import { defineStep } from "../define-step";
import type { PipelineCtx, StepInstance, StepResolver } from "../types/step";
import { resolveOptional, resolveRequired } from "./_resolver-utils";
import {
  STEP_DISPATCH_AGGREGATE_TYPE,
  STEP_DISPATCH_REQUESTED_TYPE,
} from "./_step-dispatch-constants";

type MailSendArgs = {
  readonly to: StepResolver<string | readonly string[]>;
  readonly subject: StepResolver<string>;
  readonly body: StepResolver<string>;
  readonly from?: StepResolver<string>;
  readonly mode: "deferred";
};

defineStep<MailSendArgs, void>({
  kind: "mail.send",
  tier: 2,
  defaultFailureStrategy: "throw",
  run: async (args, ctx: PipelineCtx) => {
    const to = resolveRequired(args.to, ctx);
    const subject = resolveRequired(args.subject, ctx);
    const body = resolveRequired(args.body, ctx);
    const from = resolveOptional(args.from, ctx);
    await ctx.unsafeAppendEvent({
      aggregateId: randomUUID(),
      aggregateType: STEP_DISPATCH_AGGREGATE_TYPE,
      type: STEP_DISPATCH_REQUESTED_TYPE,
      payload: {
        stepKind: "mail.send",
        spec: { to, subject, body, ...(from && { from }) },
      },
    });
  },
});

export function buildMailSendStep(args: MailSendArgs): StepInstance {
  return { kind: "mail.send", args };
}
