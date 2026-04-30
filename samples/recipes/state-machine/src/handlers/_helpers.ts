// Shared shape for every state-changing handler: load the current state,
// optionally guardTransition, append the domain event, return a WriteResult
// that reflects the post-write status.

import type { AccessRule } from "@kumiko/framework/engine";
import { defineWriteHandler, guardTransition } from "@kumiko/framework/engine";
import { failNotFound } from "@kumiko/framework/errors";
import { z } from "zod";
import { INVOICE_TRANSITIONS } from "../entities/invoice";
import { ENTITY_NAME } from "../events";
import { type InvoiceStatus, loadInvoiceState } from "../reducer";

export function transitionHandler(opts: {
  name: string;
  toStatus: InvoiceStatus;
  eventType: string;
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

      await ctx.appendEventUnsafe({
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
