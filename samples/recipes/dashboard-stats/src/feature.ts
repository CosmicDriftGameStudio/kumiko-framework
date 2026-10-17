// Dashboard Stats Sample
// Shows: a dashboard screen with a stat-group and a single stat, backed by one
// query handler that counts in the database.

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
});

export const TICKET_STATS_QUERY = "tickets:query:ticket:stats";

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
  r.queryHandler(
    "ticket:stats",
    z.object({}),
    async (query, ctx) => {
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
    { access: readerRoles },
  );

  r.translations({
    keys: {
      "tickets.dashboard.group": { en: "Tickets by status" },
      "tickets.dashboard.open": { en: "Open" },
      "tickets.dashboard.closed": { en: "Closed" },
      "tickets.dashboard.total": { en: "All tickets" },
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
    ],
    access: readerRoles,
  });
});
