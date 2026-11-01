// API docs sample: a helpdesk whose ticket handlers are reachable with a personal access token.
// Every handler a token scope reaches needs a description and, per locale, a title, description
// and field labels; `kumiko api-docs` turns them into the pages under api-docs/.

import { createPersonalAccessTokensFeature } from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import {
  createEntity,
  createEntityExecutor,
  createSelectField,
  createTextField,
  defineFeature,
  emitEvent,
  setFields,
} from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound, failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";

export const ticketEntity = createEntity({
  table: "read_api_docs_tickets",
  webhookEvents: true,
  description: "A support request with a title, a priority and an open or closed status.",
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
    status: createSelectField({ options: ["open", "closed"] as const, default: "open" }),
    priority: createSelectField({ options: ["low", "normal", "high"] as const, default: "normal" }),
  },
});

const ticketAccess = { roles: ["Admin", "User"] } as const;

export const helpdeskFeature = defineFeature("helpdesk", (r) => {
  const { table: ticketTable, executor: ticketExecutor } = createEntityExecutor(
    "ticket",
    ticketEntity,
  );

  r.crud("ticket", ticketEntity, {
    write: { access: ticketAccess },
    read: { access: ticketAccess },
    verbs: { delete: false },
    descriptions: {
      create: "Opens a new ticket.",
      update: "Changes the title or the priority of a ticket.",
      list: "Lists tickets, newest first.",
      detail: "Returns one ticket.",
    },
  });

  const ticketClosed = r.defineEvent("ticket-closed", z.object({ resolution: z.string().min(1) }), {
    piiFields: "none",
  });

  r.defineWebhookEvent({
    name: "ticket-closed",
    wireName: "ticket.closed",
    description: "A ticket was closed and its resolution recorded.",
    payload: z.object({
      id: z.uuid().describe("ID of the closed ticket"),
      resolution: z.string().describe("How the ticket was resolved"),
    }),
    version: 1,
  });

  r.writeHandler({
    name: "ticket:close",
    description: "Closes a ticket and records how it was resolved.",
    schema: z.object({ id: z.uuid(), resolution: z.string().min(1) }),
    access: ticketAccess,
    handler: async (event, ctx) => {
      const ticket = await ticketExecutor.detail({ id: event.payload.id }, event.user, ctx.db);
      if (!ticket) return failNotFound("ticket", event.payload.id);
      if (ticket["status"] === "closed") return failUnprocessable("ticket_already_closed");
      await emitEvent(ctx, ticketClosed, {
        aggregateId: event.payload.id,
        aggregateType: "ticket",
        payload: { resolution: event.payload.resolution },
      });
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
  });

  // Reachable from a screen but deliberately outside every token scope: see uiOnlyWrites in kumiko.config.ts.
  r.writeHandler({
    name: "ticket:purge",
    description: "Removes tickets that were closed long ago.",
    schema: z.object({ olderThanDays: z.number().int().min(30) }),
    access: { roles: ["Admin"] },
    handler: async () => ({ isSuccess: true as const, data: { purged: 0 } }),
  });

  const markTicketClosed = setFields(ticketTable, { status: "closed" });
  r.projection({
    name: "ticket-status",
    source: "ticket",
    table: ticketTable,
    apply: { [ticketClosed.name]: (event, tx, ctx) => markTicketClosed(event, tx, ctx) },
  });

  r.screen({
    id: "ticket-list",
    type: "entityList",
    entity: "ticket",
    columns: ["title", "status", "priority"],
  });
  r.screen({
    id: "ticket-edit",
    type: "entityEdit",
    entity: "ticket",
    layout: { sections: [{ title: "helpdesk:section.ticket", fields: ["title", "priority"] }] },
  });
  r.screen({
    id: "close-ticket",
    type: "actionForm",
    handler: "helpdesk:write:ticket:close",
    fields: { resolution: createTextField({ personal: false, reason: "is_business_data" }) },
    layout: { sections: [{ title: "helpdesk:section.close", fields: ["resolution"] }] },
  });
  r.screen({
    id: "purge-tickets",
    type: "actionForm",
    handler: "helpdesk:write:ticket:purge",
    fields: {},
    layout: { sections: [] },
  });

  r.nav({ id: "tickets", label: "helpdesk:nav:tickets", screen: "helpdesk:screen:ticket-list" });
  r.nav({ id: "settings", label: "helpdesk:nav:settings" });
  r.nav({
    id: "api-tokens",
    label: "helpdesk:nav:api-tokens",
    parent: "helpdesk:nav:settings",
    screen: "personal-access-tokens:screen:api-tokens",
  });

  r.translations({
    keys: {
      "helpdesk:nav:tickets": { en: "Tickets", de: "Tickets" },
      "helpdesk:nav:settings": { en: "Settings", de: "Einstellungen" },
      "helpdesk:nav:api-tokens": { en: "API tokens", de: "API-Tokens" },
      "helpdesk:section.ticket": { en: "Ticket", de: "Ticket" },
      "helpdesk:section.close": { en: "Close ticket", de: "Ticket schließen" },
      "helpdesk:entity:ticket:field:title": { en: "Title", de: "Titel" },
      "helpdesk:entity:ticket:field:status": { en: "Status", de: "Status" },
      "helpdesk:entity:ticket:field:priority": { en: "Priority", de: "Priorität" },
      "helpdesk:write:ticket:create:title": { en: "Create ticket", de: "Ticket anlegen" },
      "helpdesk:write:ticket:create:description": {
        en: "Opens a new ticket.",
        de: "Legt ein neues Ticket an.",
      },
      "helpdesk:write:ticket:update:title": { en: "Update ticket", de: "Ticket ändern" },
      "helpdesk:write:ticket:update:description": {
        en: "Changes the title or the priority of a ticket.",
        de: "Ändert Titel oder Priorität eines Tickets.",
      },
      "helpdesk:query:ticket:list:title": { en: "List tickets", de: "Tickets auflisten" },
      "helpdesk:query:ticket:list:description": {
        en: "Lists tickets, newest first.",
        de: "Listet Tickets, neueste zuerst.",
      },
      "helpdesk:query:ticket:detail:title": { en: "Show ticket", de: "Ticket anzeigen" },
      "helpdesk:query:ticket:detail:description": {
        en: "Returns one ticket.",
        de: "Liefert ein Ticket.",
      },
      "helpdesk:write:ticket:close:title": { en: "Close ticket", de: "Ticket schließen" },
      "helpdesk:write:ticket:close:description": {
        en: "Closes a ticket and records how it was resolved.",
        de: "Schließt ein Ticket und hält fest, wie es gelöst wurde.",
      },
      "helpdesk:write:ticket:close:field:id": { en: "Ticket", de: "Ticket" },
      "helpdesk:write:ticket:close:field:resolution": { en: "Resolution", de: "Lösung" },
      "helpdesk:write:ticket:purge:title": { en: "Purge tickets", de: "Tickets bereinigen" },
      "helpdesk:write:ticket:purge:description": {
        en: "Removes tickets that were closed long ago.",
        de: "Entfernt Tickets, die lange geschlossen sind.",
      },
      "helpdesk:write:ticket:purge:field:olderThanDays": {
        en: "Closed longer than (days)",
        de: "Länger geschlossen als (Tage)",
      },
      "helpdesk:entity:ticket": { en: "ticket", de: "Ticket" },
      "helpdesk:entity:ticket:field:id": { en: "Ticket ID", de: "Ticket-ID" },
      "helpdesk:webhook:ticket-closed:description": {
        en: "A ticket was closed and its resolution recorded.",
        de: "Ein Ticket wurde geschlossen und seine Lösung festgehalten.",
      },
      "helpdesk:webhook:ticket-closed:field:id": {
        en: "ID of the closed ticket",
        de: "ID des geschlossenen Tickets",
      },
      "helpdesk:webhook:ticket-closed:field:resolution": {
        en: "How the ticket was resolved",
        de: "Wie das Ticket gelöst wurde",
      },
      "helpdesk:entity:__action-form__:field:resolution": { en: "Resolution", de: "Lösung" },
    },
  });
});

export const PAT_RATE_LIMIT = { maxRequests: 60, windowMs: 60_000 } as const;

export function patFeature() {
  return createPersonalAccessTokensFeature({
    scopes: {
      tickets: {
        label: "Tickets",
        events: ["ticket.created", "helpdesk:ticket-closed"],
        read: ["helpdesk:query:ticket:*"],
        write: [
          "helpdesk:write:ticket:create",
          "helpdesk:write:ticket:update",
          "helpdesk:write:ticket:close",
        ],
      },
    },
    rateLimit: PAT_RATE_LIMIT,
  });
}
