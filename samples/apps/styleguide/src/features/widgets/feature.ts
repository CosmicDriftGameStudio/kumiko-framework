// Widgets-Feature (server). Zwei Screens:
//   widgets           — custom Katalog-Screen (alle Widgets mit statischen Daten)
//   widgets-dashboard — deklarativer dashboard-Screen (stat/chart/list-Panels
//                       aus Demo-Queries) — der Schema-getriebene Gegenpart.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { WIDGETS_I18N } from "./i18n";

// Statische Demo-Zeitreihe (48 Punkte à 30 Minuten) — kein Date-API,
// das Fenster ist relativ zu 0 definiert.
const RESPONSE_POINTS = Array.from({ length: 48 }, (_, i) => ({
  atMs: i * 30 * 60 * 1000,
  value: i === 20 ? null : 120 + Math.round(80 * Math.abs(Math.sin(i / 5))),
}));

const SENDERS = ["William Smith", "Alice Smith", "Bob Johnson", "Emily Davis"] as const;
const SUBJECTS = ["Meeting Tomorrow", "Re: Project Update", "Weekend Plans", "Re: Budget"] as const;

// Statische Demo-Inbox (18 Nachrichten) für die InfinityList-Demo — genug
// Rows, um über pageSize=6 hinweg mehrere Seiten nachzuladen.
const INBOX_MESSAGES = Array.from({ length: 18 }, (_, i) => ({
  id: `m${i + 1}`,
  // Cast is sound: `i % SENDERS.length` is always in [0, SENDERS.length) —
  // noUncheckedIndexedAccess can't see that from a computed index, unlike
  // the removed `as string` this replaces (which had no such guarantee).
  sender: SENDERS[i % SENDERS.length] as (typeof SENDERS)[number],
  subject: SUBJECTS[i % SUBJECTS.length] as (typeof SUBJECTS)[number],
  snippet: "Hi team, just a reminder about our meeting tomorrow at 10 AM.",
  // % 4 statt % 3: bleibt an der sender/subject-Rotation ausgerichtet, sonst
  // ist irgendwann jede Kombination mal unread und der Filter zeigt visuell
  // keinen Unterschied.
  unread: i % 4 === 0,
}));

export const widgetsFeature = defineFeature("widgets", (r) => {
  r.screen({ id: "widgets", type: "custom", renderer: { react: { __component: "widgets" } } });
  r.screen({
    id: "widgets-forms",
    type: "custom",
    renderer: { react: { __component: "widgets-forms" } },
  });

  r.screen({
    id: "widgets-dashboard",
    type: "dashboard",
    filter: {
      id: "region",
      label: "widgets:dashboard:filter-region",
      kind: "select",
      options: [
        { value: "eu", label: "widgets:dashboard:filter-region-eu" },
        { value: "us", label: "widgets:dashboard:filter-region-us" },
      ],
    },
    panels: [
      {
        kind: "stat",
        id: "portfolio",
        label: "widgets:dashboard:portfolio",
        query: "widgets:query:metrics:portfolio-stat",
        valueField: "value",
        subField: "sub",
        toneField: "tone",
        deltaField: "delta",
        deltaDirectionField: "deltaDirection",
        deltaToneField: "deltaTone",
        icon: { react: { __component: "widgets-dashboard-kpi-icon" } },
        accentColor: "var(--color-primary)",
      },
      {
        kind: "stat-group",
        id: "net-worth",
        label: "widgets:dashboard:net-worth",
        stats: [
          {
            kind: "stat",
            id: "net-worth-assets",
            label: "widgets:dashboard:net-worth-assets",
            query: "widgets:query:metrics:net-worth-assets",
            valueField: "value",
          },
          {
            kind: "stat",
            id: "net-worth-debts",
            label: "widgets:dashboard:net-worth-debts",
            query: "widgets:query:metrics:net-worth-debts",
            valueField: "value",
          },
        ],
      },
      {
        kind: "chart",
        id: "response-times",
        label: "widgets:dashboard:response-times",
        chart: "timeseries",
        query: "widgets:query:metrics:response-times",
      },
      {
        kind: "list",
        id: "latest",
        label: "widgets:dashboard:latest",
        query: "widgets:query:metrics:latest-items",
        columns: [
          { field: "name", label: "widgets:dashboard:col-name" },
          { field: "status", label: "widgets:dashboard:col-status" },
        ],
      },
      {
        kind: "feed",
        id: "upcoming",
        label: "widgets:dashboard:upcoming",
        query: "widgets:query:metrics:upcoming-events",
      },
      {
        kind: "progress-list",
        id: "goal-progress",
        label: "widgets:dashboard:goal-progress",
        query: "widgets:query:metrics:goal-progress",
      },
      {
        kind: "custom",
        id: "filter-echo",
        component: { react: { __component: "widgets-dashboard-filter-echo" } },
      },
    ],
  });

  r.queryHandler(
    "metrics:portfolio-stat",
    z.object({ region: z.string().optional() }),
    async ({ payload: { region } }) => ({
      value: region === "us" ? "38.120 $" : region === "eu" ? "54.630 €" : "92.753 €",
      sub: "über 4 Konten",
      tone: "positive",
      delta: "12 %",
      deltaDirection: "up",
      deltaTone: "positive",
    }),
    { access: { openToAll: true } },
  );
  r.queryHandler(
    "metrics:net-worth-assets",
    z.object({ region: z.string().optional() }),
    async () => ({ value: "120.000 €" }),
    { access: { openToAll: true } },
  );
  r.queryHandler(
    "metrics:net-worth-debts",
    z.object({ region: z.string().optional() }),
    async () => ({ value: "65.370 €" }),
    { access: { openToAll: true } },
  );
  r.queryHandler(
    "metrics:response-times",
    z.object({}),
    async () => ({
      points: RESPONSE_POINTS,
      windowStartMs: 0,
      windowEndMs: 24 * 60 * 60 * 1000,
    }),
    { access: { openToAll: true } },
  );
  r.queryHandler(
    "metrics:latest-items",
    z.object({}),
    async () => ({
      rows: [
        { id: "i1", name: "API-Timeout eu-central", status: "resolved" },
        { id: "i2", name: "Zertifikat erneuert", status: "done" },
      ],
      nextCursor: null,
    }),
    { access: { openToAll: true } },
  );
  r.queryHandler(
    "metrics:inbox-messages",
    z.object({
      cursor: z.coerce.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      unreadOnly: z.boolean().optional(),
      search: z.string().optional(),
    }),
    async ({ payload: { cursor, limit, unreadOnly, search } }) => {
      const term = search?.trim().toLowerCase() ?? "";
      const filtered = INBOX_MESSAGES.filter(
        (m) =>
          (unreadOnly !== true || m.unread) &&
          (term === "" ||
            m.sender.toLowerCase().includes(term) ||
            m.subject.toLowerCase().includes(term)),
      );
      const start = cursor ?? 0;
      const pageSize = limit ?? 6;
      const rows = filtered.slice(start, start + pageSize);
      const nextCursor = start + pageSize < filtered.length ? String(start + pageSize) : null;
      return { rows, nextCursor };
    },
    { access: { openToAll: true } },
  );
  r.queryHandler(
    "metrics:upcoming-events",
    z.object({}),
    async () => ({
      rows: [
        { primary: "Zinsanpassung Baudarlehen", trailing: "Aug 2026" },
        { primary: "Bausparvertrag zuteilungsreif", trailing: "Okt 2026" },
      ],
    }),
    { access: { openToAll: true } },
  );
  r.queryHandler(
    "metrics:goal-progress",
    z.object({}),
    async () => ({
      rows: [
        { label: "Baudarlehen", value: "42.000 € offen", fraction: 0.71 },
        { label: "Autokredit", value: "3.200 € offen", fraction: 0.92 },
      ],
    }),
    { access: { openToAll: true } },
  );

  r.translations({ keys: WIDGETS_I18N });

  r.nav({
    id: "widgets",
    label: "widgets:nav.widgets",
    parent: "gallery:nav:styleguide",
    screen: "widgets:screen:widgets",
    icon: "layout-grid",
    order: 20,
  });
  r.nav({
    id: "widgets-forms",
    label: "widgets:nav.widgetsForms",
    parent: "gallery:nav:styleguide",
    screen: "widgets:screen:widgets-forms",
    icon: "clipboard-list",
    order: 21,
  });
  r.nav({
    id: "widgets-dashboard",
    label: "widgets:nav.widgetsDashboard",
    parent: "gallery:nav:styleguide",
    screen: "widgets:screen:widgets-dashboard",
    icon: "gauge",
    order: 22,
  });
});
