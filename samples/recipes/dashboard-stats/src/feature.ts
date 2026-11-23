// Dashboard Stats Sample
// Shows: a dashboard screen with a stat-group and a single stat, backed by one
// query handler that counts in the database. A second, record-bound dashboard embeds a
// projectionDetail as a panel, hides a toolbar button behind a capability query, and picks its
// fallback screen by the reason the gate closed.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { readerRoles } from "./access";
import { ticketCapabilitiesQuery } from "./handlers/ticket-capabilities.query";
import { ticketCardQuery } from "./handlers/ticket-card.query";
import { ticketDesignQuery } from "./handlers/ticket-design.query";
import { ticketOverviewQuery } from "./handlers/ticket-overview.query";
import { ticketQuotaQuery } from "./handlers/ticket-quota.query";
import { ticketRecentQuery } from "./handlers/ticket-recent.query";
import { ticketRowsQuery } from "./handlers/ticket-rows.query";
import { ticketStatsQuery } from "./handlers/ticket-stats.query";
import { ticketEntity } from "./schema/ticket";
import { createTicketDesignScreen } from "./screens";

export { TICKET_STATUSES, ticketEntity } from "./schema/ticket";

export const TICKET_STATS_QUERY = "tickets:query:ticket:stats";
export const TICKET_OVERVIEW_QUERY = "tickets:query:ticket:overview";
export const TICKET_CAPABILITIES_QUERY = "tickets:query:ticket:capabilities";
export const TICKET_LIST_QUERY = "tickets:query:ticket:list";
export const TICKET_DESIGN_QUERY = "tickets:query:ticket:design";

export const ticketFeature = defineFeature("tickets", (r) => {
  r.crud(ticketEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: readerRoles },
  });

  r.queryHandler(ticketStatsQuery);
  r.queryHandler(ticketCapabilitiesQuery);
  r.queryHandler(ticketCardQuery);
  r.queryHandler(ticketRowsQuery);
  r.queryHandler(ticketRecentQuery);
  r.queryHandler(ticketQuotaQuery);
  r.queryHandler(ticketOverviewQuery);
  r.queryHandler(ticketDesignQuery);

  r.translations({
    keys: {
      "tickets.dashboard.recent": { en: "Recent tickets" },
      "tickets.dashboard.recent-more": { en: "{count} more tickets" },
      "tickets.dashboard.quota": { en: "Quota {month}" },
      "screen:ticket-list.title": { en: "Tickets" },
      "screen:ticket-card.title": { en: "Ticket" },
      "screen:ticket-overview.title": { en: "Ticket overview (one query)" },
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
      "tickets.dashboard.total-narrow": { en: { one: "{count} ticket", other: "{count} tickets" } },
      "tickets.dashboard.open-work": { en: "Open work" },
      "tickets.filter.open-work": { en: "Open work" },
      "screen:ticket-queue.title": { en: "Ticket queue" },
      "screen:ticket-design.title": { en: "Support desk" },
      "tickets.design.kpis": { en: "This week" },
      "tickets.design.opened": { en: "Opened" },
      "tickets.design.escalated": { en: "Escalated" },
      "tickets.design.weekly": { en: "Opened per day" },
      "tickets.design.by-team": { en: "By team" },
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
        // Below sm the label is replaced by this plural key, resolved with { count: <value> }.
        labelNarrow: "tickets.dashboard.total-narrow",
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
      // Without `label` the footer is only the muted "k more" count, no link.
      {
        kind: "list",
        id: "recent",
        label: "tickets.dashboard.recent",
        query: "tickets:query:ticket:recent",
        // `badgeIcon: "sparkles"` draws an AI-prepared value as the soft blue AI pill with an icon.
        columns: ["title", { field: "status", display: "badge", badgeIcon: "sparkles" }],
        footerLink: { moreText: "tickets.dashboard.recent-more", screen: "ticket-queue" },
      },
      // The title takes its month from the answer and the period shows muted at the head's right.
      {
        kind: "progress-list",
        id: "quota",
        label: "tickets.dashboard.quota",
        labelParams: { month: "month" },
        subtitleField: "period",
        query: "tickets:query:ticket:quota",
      },
    ],
    access: readerRoles,
  });

  r.screen({
    id: "ticket-overview",
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
            query: TICKET_OVERVIEW_QUERY,
            resultField: "stats",
            valueField: "open",
          },
          {
            kind: "stat",
            id: "closed",
            label: "tickets.dashboard.closed",
            query: TICKET_OVERVIEW_QUERY,
            resultField: "stats",
            valueField: "closed",
          },
        ],
      },
      {
        kind: "list",
        id: "recent",
        label: "tickets.dashboard.recent",
        query: TICKET_OVERVIEW_QUERY,
        resultField: "recent",
        columns: ["title", "status"],
      },
    ],
    access: readerRoles,
  });

  r.screen(createTicketDesignScreen(TICKET_DESIGN_QUERY));

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
