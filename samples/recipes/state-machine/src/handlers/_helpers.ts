// Shared shape for every state-changing handler: load the current state,
// optionally guardTransition, append the domain event, return a WriteResult
// that reflects the post-write status.

import type { AccessRule, KumikoEventTypeMap } from "@app/define";
import { defineWriteHandler, guardTransition } from "@app/define";
import { failNotFound } from "@kumiko/framework/errors";
import { z } from "zod";
import { INVOICE_TRANSITIONS } from "../entities/invoice";
import { ENTITY_NAME } from "../events";
import { type InvoiceStatus, loadInvoiceState } from "../reducer";

// Narrow TEvent to event-types whose payload is `{}` — this helper
// always emits an empty payload. Anyone trying to use it with a non-
// empty-payload event-type gets caught at the call-site, not at runtime.
type EmptyPayloadEvent = {
  [K in keyof KumikoEventTypeMap]: KumikoEventTypeMap[K] extends Record<string, never>
    ? K
    : never;
}[keyof KumikoEventTypeMap];

export function transitionHandler<const TEvent extends EmptyPayloadEvent>(opts: {
  name: string;
  toStatus: InvoiceStatus;
  eventType: TEvent;
  access: AccessRule;
  skipGuard?: boolean;
}) {
  return defineWriteHandler({
    name: opts.name,
    schema: z.object({ id: z.uuid() }),
    access: opts.access,
    handler: async (event, ctx) => {
      const state = await loadInvoiceState(ctx, event.payload.id);
      if (!state) return failNotFound(ENTITY_NAME, event.payload.id);

      if (!opts.skipGuard) {
        guardTransition(INVOICE_TRANSITIONS, state.status, opts.toStatus);
      }

      await ctx.appendEvent({
        aggregateId: event.payload.id,
        aggregateType: ENTITY_NAME,
        type: opts.eventType,
        payload: {},
      });

      return successResult(event.payload.id, opts.toStatus, state.status);
    },
  });
}

export function successResult(id: string, newStatus: InvoiceStatus, previousStatus: string) {
  return {
    isSuccess: true as const,
    data: {
      id,
      data: { status: newStatus },
      changes: { status: newStatus },
      previous: { status: previousStatus },
      isNew: false,
      entityName: ENTITY_NAME,
    },
  };
}
