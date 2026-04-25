// Delivery Notifications Sample
//
// Shows how a feature sends notifications via multiple channels (inApp + email + push).
// Uses r.notification() for declarative notifications with per-channel templates.
//
// Flow: Admin assigns a support ticket to a user → the user gets notified
//   - InApp: toast + badge in the app
//   - Email: full HTML with rendered content
//   - Push: native notification
//
// The feature code only declares WHAT to notify. HOW is handled by Delivery.

import { buildDrizzleTable, createEventStoreExecutor } from "@kumiko/framework/db";
import { createEntity, createTextField, defineFeature } from "@kumiko/framework/engine";
import { z } from "zod";

// --- Entity ---

export const ticketEntity = createEntity({
  table: "read_sample_delivery_tickets",
  fields: {
    title: createTextField({ required: true, maxLength: 200 }),
    description: createTextField({ maxLength: 2000 }),
    assigneeId: createTextField(),
    priority: createTextField({ required: true }), // "low" | "normal" | "critical"
    status: createTextField({ required: true }),
  },
});

export const ticketTable = buildDrizzleTable("ticket", ticketEntity);

function ticketExecutor() {
  return createEventStoreExecutor(ticketTable, ticketEntity, { entityName: "ticket" });
}

// --- Feature ---

export const supportFeature = defineFeature("support", (r) => {
  r.requires("delivery");

  r.entity("ticket", ticketEntity);

  // Real CRUD handler (not stub) — returns SaveContext for lifecycle hooks
  const createHandler = r.writeHandler(
    "ticket:create",
    z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      assigneeId: z.uuid().optional(),
      priority: z.enum(["low", "normal", "critical"]),
      status: z.string().default("open"),
    }),
    async (event, ctx) => ticketExecutor().create(event.payload, event.user, ctx.db),
    { access: { roles: ["Admin", "Support"] } },
  );

  // Declarative notification: fires automatically after ticket.create postSave.
  //
  // - recipient: returns assignee ID, or null to skip (no assignee = no notification)
  // - data: extracts raw fields from the save result
  // - templates: per-channel transformations
  //     inApp → short title/body for toast
  //     email → structured template (header, sections, button) for renderer
  //     push → short title/body for native notification
  r.notification("ticket-assigned", {
    trigger: { on: createHandler },
    recipient: (result) => {
      const assigneeId = result.data["assigneeId"] as number | undefined;
      return assigneeId ?? null;
    },
    data: (result) => ({
      ticketId: result.id,
      title: result.data["title"] as string,
      description: (result.data["description"] as string) ?? "",
      priority: result.data["priority"] as string,
    }),
    templates: {
      inApp: (data) => ({
        title: `Neues Ticket: ${data["title"]}`,
        body: (data["description"] as string) || "Dir wurde ein Ticket zugewiesen.",
      }),
      email: (data) => ({
        subject: `Support-Ticket #${data["ticketId"]} (${data["priority"]})`,
        header: `Neues Ticket: ${data["title"]}`,
        sections: [
          { text: (data["description"] as string) || "Kein Beschreibungstext." },
          { text: `Prioritaet: ${data["priority"]}` },
          {
            button: {
              label: "Ticket oeffnen",
              url: `/support/tickets/${data["ticketId"]}`,
            },
          },
        ],
        footer: "Automatische Benachrichtigung — nicht antworten.",
      }),
      push: (data) => ({
        title: "Neues Ticket",
        body: `${data["title"]} (${data["priority"]})`,
      }),
    },
  });
});
