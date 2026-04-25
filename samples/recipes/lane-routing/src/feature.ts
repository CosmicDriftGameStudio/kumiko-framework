// Lane-Routing Sample
//
// Shows `r.job({ runIn: "worker" })` end-to-end: an HTTP write emits an
// event, the event fans out to two worker-lane jobs via BullMQ, and the
// jobs actually execute on the worker lane (kumiko-jobs-worker queue).
//
// Deploy-shape: any of the three entrypoints. The test uses
// createAllInOneEntrypoint so the Single Integration-Test covers the full
// path without having to coordinate two processes.

import {
  createEntity,
  createNumberField,
  createTextField,
  defineFeature,
  type FeatureDefinition,
} from "@kumiko/framework/engine";
import { z } from "zod";

// In-memory collectors so the integration-test can assert both jobs ran
// and got the right payload. A real app would do DB writes, HTTP calls,
// PDF rendering, mail sending — whatever the side-effect is, it's
// opaque to the framework.
export const renderedReceipts: Array<{ customerName: string; amount: number }> = [];
export const sentConfirmations: Array<{ customerName: string; amount: number }> = [];

// Entity-Dekl sichert den qualified-name-Prefix "orders:write:order:create"
// für den Write-Handler unten und damit den Job-Trigger auf diesem Event.
// Persistenz passiert im Custom-Handler nicht (id ist hardcoded für den
// Sample-Test) — in einer echten App würde ein entityWriteHandler in die DB
// schreiben.
const orderEntity = createEntity({
  table: "read_orders",
  fields: {
    customerName: createTextField({ required: true }),
    amount: createNumberField({ required: true }),
  },
});

export function createLaneRoutingFeature(): FeatureDefinition {
  return defineFeature("orders", (r) => {
    r.entity("order", orderEntity);

    // Write handler — runs in the API process (or wherever the command
    // lands). Event "orders:write:order:create" is the auto-generated
    // write-event both jobs trigger on.
    r.writeHandler(
      "order:create",
      z.object({
        customerName: z.string().min(1),
        amount: z.number().positive(),
      }),
      async (event) => ({
        isSuccess: true as const,
        data: {
          id: 1,
          customerName: event.payload.customerName,
          amount: event.payload.amount,
        },
      }),
      { access: { openToAll: true } },
    );

    // Receipt-rendering: heavy CPU work. Pinned to `worker` so the
    // BullMQ consumer on the API process never picks it up — even if the
    // API happens to run runLocalJobs for something else. `runIn` is the
    // Welle-2.6 contract that makes this stable across deploy shapes.
    r.job(
      "render-receipt",
      {
        trigger: { on: "orders:write:order:create" },
        runIn: "worker",
      },
      async (payload) => {
        renderedReceipts.push({
          customerName: payload["customerName"] as string,
          amount: payload["amount"] as number,
        });
      },
    );

    // Confirmation-mail: external I/O. Also worker-lane. Both jobs fan
    // out from the same event in parallel — BullMQ handles their order
    // independently.
    r.job(
      "send-confirmation",
      {
        trigger: { on: "orders:write:order:create" },
        runIn: "worker",
      },
      async (payload) => {
        sentConfirmations.push({
          customerName: payload["customerName"] as string,
          amount: payload["amount"] as number,
        });
      },
    );
  });
}
