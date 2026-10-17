// Shared shape for every state-changing handler: load the current state,
// optionally guardTransition, append the domain event, return a WriteResult
// that reflects the post-write status.

import {
  type AccessRule,
  defineWriteHandler,
  type EventDef,
  emitEvent,
  guardTransition,
} from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { INVOICE_TRANSITIONS } from "../entities/invoice";
import { ENTITY_NAME, type emptyEventPayload } from "../events";
import { type InvoiceStatus, loadInvoiceState } from "../reducer";

// The event carries an empty payload — this helper always emits `{}`, so an EventDef with a
// non-empty payload is a compile error at the call site.
export function transitionHandler(opts: {
  name: string;
  toStatus: InvoiceStatus;
  event: EventDef<z.infer<typeof emptyEventPayload>>;
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

      // state.status carries the "missing" virtual-state for aggregates
      // that haven't been seen yet; loadInvoiceState already filters
      // null, so at this point we know we're past existence. Cast to
      // InvoiceStatus for the guard — "missing" can never appear after
      // the !state check above.
      if (!opts.skipGuard) {
        guardTransition(INVOICE_TRANSITIONS, state.status as InvoiceStatus, opts.toStatus);
      }

      await emitEvent(ctx, opts.event, {
        aggregateId: event.payload.id,
        aggregateType: ENTITY_NAME,
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
