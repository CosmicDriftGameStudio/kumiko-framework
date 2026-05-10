// r.step.aggregate.appendEvent — write an additional domain-event onto
// an existing aggregate stream.
//
// Wraps ctx.unsafeAppendEvent: the event lands on the named aggregate
// stream in the active TX, downstream projections (multiStreamProjection)
// fire, audit-trail captures it. Used when a write-handler needs to
// record a domain event that's NOT one of the auto-generated CRUD
// events (e.g. "incident.update-posted" on the same incident stream
// that already carries "incident.created").
//
// Why `unsafeAppendEvent` (not the strict `appendEvent`): step.run sees
// `ctx` as PipelineCtx<unknown, KumikoEventTypeMap> after the variance-
// bridge cast in run-pipeline.ts. The strict TMap-typed appendEvent
// would collapse `keyof TMap` to `never` from the framework-side. Strict
// typing of appendEvent inside steps is a deferred pass (post-M.1.5).
// At the call-site users still spell `type` as a string-literal — TS
// catches typos against the QualifiedEventName union when the literal
// matches a registered EventDef.
//
// No result-key — appendEvent doesn't surface a value to subsequent
// steps (the event-store assigns the position, but consumers don't
// need it during the same handler call).

import { defineStep } from "../define-step";
import type { PipelineCtx, StepInstance, StepResolver } from "../types/step";

type AggregateAppendEventArgs = {
  readonly aggregateId: StepResolver<string>;
  readonly aggregateType: string;
  readonly type: string;
  readonly payload: StepResolver<unknown>;
  readonly headers?: StepResolver<Readonly<Record<string, string | number | boolean>>>;
};

defineStep<AggregateAppendEventArgs, void>({
  kind: "aggregate.appendEvent",
  defaultFailureStrategy: "throw",
  run: async (args, ctx: PipelineCtx) => {
    const aggregateId =
      typeof args.aggregateId === "function" ? args.aggregateId(ctx) : args.aggregateId;
    const payload = typeof args.payload === "function" ? args.payload(ctx) : args.payload;
    const headers =
      args.headers === undefined
        ? undefined
        : typeof args.headers === "function"
          ? args.headers(ctx)
          : args.headers;

    await ctx.unsafeAppendEvent({
      aggregateId,
      aggregateType: args.aggregateType,
      type: args.type,
      payload,
      ...(headers !== undefined && { headers }),
    });
  },
});

export function buildAggregateAppendEventStep(args: AggregateAppendEventArgs): StepInstance {
  return { kind: "aggregate.appendEvent", args };
}
