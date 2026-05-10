// webhook-step Sample — Tier-2 r.step.webhook.send showcase.
//
// A minimal "incident-open" handler that opens an incident aggregate and
// dispatches a Zapier-style webhook in deferred mode. The webhook fires
// only after the TX commits — if the aggregate.create rolls back, the
// webhook does NOT go out (the step.dispatch-requested event vanishes
// with the rollback).

import { buildDrizzleTable, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  defineWriteHandler,
  pipeline,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const incidentEntity = createEntity({
  table: "read_webhook_demo_incidents",
  fields: {
    title: createTextField({ required: true }),
    severity: createTextField({ required: true }),
  },
});

export const incidentTable = buildDrizzleTable("incident", incidentEntity);
const incidentExecutor = createEventStoreExecutor(incidentTable, incidentEntity, {
  entityName: "incident",
});

export const webhookDemoFeature = defineFeature("webhook-demo", (r) => {
  r.entity("incident", incidentEntity);
  r.requires.step("webhook.send");
  r.requires.step("mail.send");
  r.requires.step("callFeature");

  r.writeHandler(
    defineWriteHandler({
      name: "incident:open",
      schema: z.object({
        title: z.string().min(1),
        severity: z.enum(["low", "medium", "high"]),
        webhookUrl: z.string(),
      }),
      access: { roles: ["Admin"] },
      perform: pipeline<
        { title: string; severity: "low" | "medium" | "high"; webhookUrl: string },
        { id: string }
      >(({ event, r }) => [
        r.step.aggregate.create("incident", {
          executor: incidentExecutor,
          data: () => ({ title: event.payload.title, severity: event.payload.severity }),
        }),
        r.step.webhook.send({
          url: () => event.payload.webhookUrl,
          mode: "deferred",
          body: ({ steps }) => ({
            event: "incident-opened",
            id: (steps["incident"] as { id: string }).id,
            title: event.payload.title,
            severity: event.payload.severity,
          }),
        }),
        r.step.return(({ steps }) => ({
          isSuccess: true as const,
          data: { id: (steps["incident"] as { id: string }).id },
        })),
      ]),
    }),
  );

  // mail.send variant — same deferred shape, different stepKind.
  // Step-dispatcher MSP routes to performMailDispatch.
  r.writeHandler(
    defineWriteHandler({
      name: "incident:notify-via-mail",
      schema: z.object({
        to: z.string(),
        title: z.string(),
        severity: z.enum(["low", "medium", "high"]),
      }),
      access: { roles: ["Admin"] },
      perform: pipeline<
        { to: string; title: string; severity: "low" | "medium" | "high" },
        { id: string }
      >(({ event, r }) => [
        r.step.aggregate.create("incident", {
          executor: incidentExecutor,
          data: () => ({ title: event.payload.title, severity: event.payload.severity }),
        }),
        r.step.mail.send({
          to: () => event.payload.to,
          subject: () => `Incident: ${event.payload.title}`,
          body: () => `Severity ${event.payload.severity}`,
          mode: "deferred",
        }),
        r.step.return(({ steps }) => ({
          isSuccess: true as const,
          data: { id: (steps["incident"] as { id: string }).id },
        })),
      ]),
    }),
  );

  // callFeature variant — sync sub-command on the same feature's
  // incident:open. Threads the result of the callFeature step into
  // the wrapper's response.
  r.writeHandler(
    defineWriteHandler({
      name: "incident:open-via-call",
      schema: z.object({ title: z.string(), severity: z.enum(["low", "medium", "high"]) }),
      access: { roles: ["Admin"] },
      perform: pipeline<{ title: string; severity: "low" | "medium" | "high" }, { id: string }>(
        ({ event, r }) => [
          r.step.callFeature("inner", {
            handler: "webhook-demo:write:incident:open",
            payload: () => ({
              title: event.payload.title,
              severity: event.payload.severity,
              webhookUrl: "https://hooks.example/from-callFeature",
            }),
          }),
          r.step.return(({ steps }) => ({
            isSuccess: true as const,
            data: { id: (steps["inner"] as { id: string }).id },
          })),
        ],
      ),
    }),
  );

  // Negative test handler: aggregate.create succeeds, then a compute step
  // throws. Proves the webhook event is rolled back too — no fetch should
  // ever fire because the step.dispatch-requested event vanishes with
  // the TX rollback.
  r.writeHandler(
    defineWriteHandler({
      name: "incident:open-then-fail",
      schema: z.object({ title: z.string().min(1), webhookUrl: z.string() }),
      access: { roles: ["Admin"] },
      perform: pipeline<{ title: string; webhookUrl: string }, never>(({ event, r }) => [
        r.step.aggregate.create("incident", {
          executor: incidentExecutor,
          data: () => ({ title: event.payload.title, severity: "high" }),
        }),
        r.step.webhook.send({
          url: () => event.payload.webhookUrl,
          mode: "deferred",
          body: () => ({ event: "incident-opened-but-rolled-back" }),
        }),
        r.step.compute("explode", () => {
          throw new Error("rollback-test: throwing AFTER webhook.send");
        }),
        r.step.return({ isSuccess: true as const, data: undefined as never }),
      ]),
    }),
  );
});
