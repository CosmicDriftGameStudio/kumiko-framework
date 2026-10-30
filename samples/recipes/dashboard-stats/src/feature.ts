// Dashboard Stats Sample
// Shows: a dashboard screen with a stat-group and a single stat, backed by one
// query handler that counts in the database. A second, record-bound dashboard embeds a
// projectionDetail as a panel, hides a toolbar button behind a capability query, and picks its
// fallback screen by the reason the gate closed.

import {
  createEntity,
  createEntityExecutor,
  createSelectField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const TICKET_STATUSES = ["open", "closed"] as const;

export const ticketEntity = createEntity({
  table: "read_sample_tickets",
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
    status: createSelectField({ options: TICKET_STATUSES, default: "open", required: true }),
  },
  // Defined once: the queue list and the dashboard tile both read it.
  namedFilters: {
    "open-work": { filters: () => [{ field: "status", op: "eq", value: "open" }] },
  },
});

export const TICKET_STATS_QUERY = "tickets:query:ticket:stats";
export const TICKET_CAPABILITIES_QUERY = "tickets:query:ticket:capabilities";
export const TICKET_LIST_QUERY = "tickets:query:ticket:list";

const readerRoles = { roles: ["Admin", "User"] } as const;

export const ticketFeature = defineFeature("tickets", (r) => {
  const { executor: ticketExecutor } = createEntityExecutor("ticket", ticketEntity);

  r.crud("ticket", ticketEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: readerRoles },
  });

  // Flat result: each dashboard stat reads one field via its valueField.
  // limit: 1 keeps the page tiny; totalCount counts over the whole WHERE in
  // the database, so no rows are loaded just to be counted.
  r.queryHandler({
    name: "ticket:stats",
    schema: z.object({}),
    handler: async (query, ctx) => {
      const countWithStatus = async (status: (typeof TICKET_STATUSES)[number]): Promise<number> => {
        const page = await ticketExecutor.list(
          { filter: { field: "status", op: "eq", value: status }, limit: 1, totalCount: true },
          query.user,
          ctx.db,
        );
        return page.total ?? 0;
      };
      const [open, closed] = await Promise.all([
        countWithStatus("open"),
        countWithStatus("closed"),
      ]);
      return { open, closed, total: open + closed };
    },
    access: readerRoles,
  });

  // Gate for the screens below: a flat answer with one boolean the screens test with `eq`.
  r.queryHandler({
    name: "ticket:capabilities",
    schema: z.object({}),
    outputSchema: z.object({ canClose: z.boolean() }),
    handler: async (query) => ({ canClose: query.user.roles.includes("Admin") }),
    access: readerRoles,
  });

  r.queryHandler({
    name: "ticket:card",
    schema: z.object({ id: z.string() }),
    handler: async (query, ctx) => {
      const page = await ticketExecutor.list(
        { filter: { field: "id", op: "eq", value: query.payload.id }, limit: 1 },
        query.user,
        ctx.db,
      );
      const ticket = page.rows[0];
      return { id: query.payload.id, title: ticket?.title ?? "", status: ticket?.status ?? "" };
    },
    access: readerRoles,
  });

  r.queryHandler({
    name: "ticket:rows",
    schema: z.object({}),
    handler: async (query, ctx) => {
      const page = await ticketExecutor.list({ limit: 50 }, query.user, ctx.db);
      return { rows: page.rows, nextCursor: null };
    },
    access: readerRoles,
  });

  r.translations({
    keys: {
      "screen:ticket-list.title": { en: "Tickets" },
      "screen:ticket-card.title": { en: "Ticket" },
      "screen:ticket-record-dashboard.title": { en: "Ticket overview" },
      "entity:ticket:field:title": { en: "Title" },
      "entity:ticket:field:status": { en: "Status" },
      "entity:__projection-detail__:field:title": { en: "Title" },
      "entity:__projection-detail__:field:status": { en: "Status" },
      "tickets.toolbar.close": { en: "Close all done" },
      "tickets.dashboard.card": { en: "Ticket" },
      "tickets.dashboard.group": { en: "Tickets by status" },
      "tickets.dashboard.open": { en: "Open" },
      "tickets.dashboard.closed": { en: "Closed" },
      "tickets.dashboard.total": { en: "All tickets" },
      "tickets.dashboard.open-work": { en: "Open work" },
      "tickets.filter.open-work": { en: "Open work" },
      "screen:ticket-queue.title": { en: "Ticket queue" },
    },
  });

  r.screen({
    id: "ticket-dashboard",
    type: "dashboard",
    panels: [
      {
        kind: "stat-group",
        id: "by-status",
        label: "tickets.dashboard.group",
        stats: [
          {
            kind: "stat",
            id: "open",
            label: "tickets.dashboard.open",
            query: TICKET_STATS_QUERY,
            valueField: "open",
          },
          {
            kind: "stat",
            id: "closed",
            label: "tickets.dashboard.closed",
            query: TICKET_STATS_QUERY,
            valueField: "closed",
          },
        ],
      },
      {
        kind: "stat",
        id: "total",
        label: "tickets.dashboard.total",
        query: TICKET_STATS_QUERY,
        valueField: "total",
      },
      // Counts through the list's own query with the same named filter, then links to that list.
      {
        kind: "stat",
        id: "open-work",
        label: "tickets.dashboard.open-work",
        query: TICKET_LIST_QUERY,
        valueField: "total",
        params: { namedFilter: "open-work", limit: 1, totalCount: true },
        navigate: { screen: "ticket-queue", namedFilter: "open-work" },
      },
    ],
    access: readerRoles,
  });

  // Three additions: a projectionDetail embedded in a record-bound dashboard, a gated toolbar
  // button, and a fallback chosen by reason.
  const gate = { query: TICKET_CAPABILITIES_QUERY, field: "canClose", eq: true } as const;

  r.screen({
    id: "ticket-queue",
    type: "entityList",
    entity: "ticket",
    columns: ["title", "status"],
    namedFilters: [{ id: "open-work", label: "tickets.filter.open-work" }],
    access: readerRoles,
  });

  // The list doubles as the fallback target: it has no visibleWhen of its own.
  r.screen({
    id: "ticket-list",
    type: "projectionList",
    query: "tickets:query:ticket:rows",
    columns: ["title", "status"],
    access: readerRoles,
    toolbarActions: [
      {
        kind: "writeHandler",
        id: "close-done",
        label: "tickets.toolbar.close",
        handler: "tickets:write:ticket:update",
        // Live and fail-closed: hidden while the query loads and when it fails.
        visibleWhen: gate,
      },
    ],
  });

  r.screen({
    id: "ticket-card",
    type: "projectionDetail",
    query: "tickets:query:ticket:card",
    layout: { sections: [{ title: "tickets.dashboard.card", fields: ["title", "status"] }] },
    access: readerRoles,
    visibleWhen: gate,
    // 403 and 404 on the gate query get their own screen; an unmet condition keeps the
    // default notice and any other failure shows an error banner with retry.
    fallback: { forbidden: "ticket-list", notFound: "ticket-list" },
  });

  // `record` reads the id from the URL; the embedded projectionDetail receives it as its entityId.
  r.screen({
    id: "ticket-record-dashboard",
    type: "dashboard",
    record: { param: "ticketId", payloadKey: "id" },
    panels: [{ kind: "screen", id: "card", screen: "ticket-card" }],
    access: readerRoles,
  });
});
