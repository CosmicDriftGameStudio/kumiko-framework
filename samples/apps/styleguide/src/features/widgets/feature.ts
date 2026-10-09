// Widgets-Feature (server). Zwei Screens:
//   widgets           — custom Katalog-Screen (alle Widgets mit statischen Daten)
//   widgets-dashboard — deklarativer dashboard-Screen (stat/chart/list-Panels
//                       aus Demo-Queries) — der Schema-getriebene Gegenpart.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { demoMoney, demoMonthYear, demoPercent, demoText } from "./demo-locale";
import { WIDGETS_I18N } from "./i18n";

// Statische Demo-Zeitreihe (48 Punkte à 30 Minuten) — kein Date-API,
// das Fenster ist relativ zu 0 definiert.
const RESPONSE_POINTS = Array.from({ length: 48 }, (_, i) => ({
  atMs: i * 30 * 60 * 1000,
  value: i === 20 ? null : 120 + Math.round(80 * Math.abs(Math.sin(i / 5))),
}));

const LOAN_START_MS = Date.UTC(2020, 0, 1);
const LOAN_TODAY_MS = Date.UTC(2026, 5, 15);
const LOAN_MONTHS = 240;
const LOAN_PRINCIPAL_MINOR = 25_000_000;
const LOAN_MONTHLY_RATE = 0.035 / 12;

const loanMonthMs = (monthIndex: number): number => Date.UTC(2020, monthIndex, 1);

// Annuity loan over 20 years: remaining principal falls, cumulative interest
// grows. "Today" is a fixed date, not the clock, so the window and the
// screenshots stay stable.
const growth = (1 + LOAN_MONTHLY_RATE) ** LOAN_MONTHS;
const annuityMinor = (LOAN_PRINCIPAL_MINOR * LOAN_MONTHLY_RATE * growth) / (growth - 1);
let balanceMinor: number = LOAN_PRINCIPAL_MINOR;
let interestPaidMinor = 0;
const LOAN_REMAINING_POINTS = [{ atMs: loanMonthMs(0), value: LOAN_PRINCIPAL_MINOR }];
const LOAN_INTEREST_POINTS = [{ atMs: loanMonthMs(0), value: 0 }];
for (let i = 1; i <= LOAN_MONTHS; i++) {
  const interest = balanceMinor * LOAN_MONTHLY_RATE;
  balanceMinor = Math.max(0, balanceMinor - (annuityMinor - interest));
  interestPaidMinor += interest;
  LOAN_REMAINING_POINTS.push({ atMs: loanMonthMs(i), value: Math.round(balanceMinor) });
  LOAN_INTEREST_POINTS.push({ atMs: loanMonthMs(i), value: Math.round(interestPaidMinor) });
}
const LOAN_SERIES = [
  { key: "remaining", label: "widgets:dashboard:loan-remaining", points: LOAN_REMAINING_POINTS },
  { key: "interest", label: "widgets:dashboard:loan-interest", points: LOAN_INTEREST_POINTS },
];
const LOAN_MARKERS = [
  { atMs: loanMonthMs(84), label: { i18nKey: "widgets:dashboard:marker-extra-1" }, kind: "extra" },
  { atMs: loanMonthMs(150), label: { i18nKey: "widgets:dashboard:marker-extra-2" }, kind: "extra" },
  {
    atMs: loanMonthMs(LOAN_MONTHS),
    label: { i18nKey: "widgets:dashboard:marker-payoff" },
    kind: "payoff",
  },
];

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

function openAmount(amount: number, locale: string): string {
  return demoText("widgets:dashboard:demo-amount-open", locale).replace(
    "{amount}",
    demoMoney(amount, "EUR", locale),
  );
}

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
        kind: "chart",
        id: "loan",
        label: "widgets:dashboard:loan",
        chart: "stacked-area",
        query: "widgets:query:metrics:loan",
        valueFormat: { kind: "currency", currency: "EUR", fractionDigits: 0 },
        brush: true,
        legendTotals: false,
        initialWindow: "from-today",
        markerLegend: "legend",
        markerKinds: {
          extra: { tone: "active", label: "widgets:dashboard:kind-extra" },
          payoff: { tone: "positive", label: "widgets:dashboard:kind-payoff" },
        },
        ranges: {
          default: "max",
          options: [
            { value: "y1", label: "widgets:dashboard:range-y1", months: 12 },
            { value: "y3", label: "widgets:dashboard:range-y3", months: 36 },
            { value: "y5", label: "widgets:dashboard:range-y5", months: 60 },
            { value: "max", label: "widgets:dashboard:range-all" },
          ],
        },
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
    async ({ payload: { region } }, ctx) => ({
      value:
        region === "us"
          ? demoMoney(38120, "USD", ctx.locale)
          : demoMoney(region === "eu" ? 54630 : 92753, "EUR", ctx.locale),
      sub: demoText("widgets:catalog:portfolio-sub", ctx.locale),
      tone: "positive",
      delta: demoPercent(0.12, ctx.locale),
      deltaDirection: "up",
      deltaTone: "positive",
    }),
    {
      access: {
        openToAll: {
          reason:
            "demo dashboard widget: returns static canned data with no per-user or " +
            "tenant scoping; any signed-in user may query it",
        },
      },
    },
  );
  r.queryHandler(
    "metrics:net-worth-assets",
    z.object({ region: z.string().optional() }),
    async (_query, ctx) => ({ value: demoMoney(120000, "EUR", ctx.locale) }),
    {
      access: {
        openToAll: {
          reason:
            "demo dashboard widget: returns static canned data with no per-user or " +
            "tenant scoping; any signed-in user may query it",
        },
      },
    },
  );
  r.queryHandler(
    "metrics:net-worth-debts",
    z.object({ region: z.string().optional() }),
    async (_query, ctx) => ({ value: demoMoney(65370, "EUR", ctx.locale) }),
    {
      access: {
        openToAll: {
          reason:
            "demo dashboard widget: returns static canned data with no per-user or " +
            "tenant scoping; any signed-in user may query it",
        },
      },
    },
  );
  r.queryHandler(
    "metrics:response-times",
    z.object({}),
    async () => ({
      points: RESPONSE_POINTS,
      windowStartMs: 0,
      windowEndMs: 24 * 60 * 60 * 1000,
    }),
    {
      access: {
        openToAll: {
          reason:
            "demo dashboard widget: returns static canned data with no per-user or " +
            "tenant scoping; any signed-in user may query it",
        },
      },
    },
  );
  r.queryHandler(
    "metrics:loan",
    z.object({}),
    async () => ({
      series: LOAN_SERIES,
      markers: LOAN_MARKERS,
      windowStartMs: LOAN_START_MS,
      windowEndMs: loanMonthMs(LOAN_MONTHS),
      todayMs: LOAN_TODAY_MS,
    }),
    {
      access: {
        openToAll: {
          reason:
            "demo dashboard widget: returns static canned data with no per-user or " +
            "tenant scoping; any signed-in user may query it",
        },
      },
    },
  );
  r.queryHandler(
    "metrics:latest-items",
    z.object({}),
    async (_query, ctx) => ({
      rows: [
        {
          id: "i1",
          name: demoText("widgets:dashboard:demo-incident-timeout", ctx.locale),
          status: "resolved",
        },
        {
          id: "i2",
          name: demoText("widgets:dashboard:demo-incident-certificate", ctx.locale),
          status: "done",
        },
      ],
      nextCursor: null,
    }),
    {
      access: {
        openToAll: {
          reason:
            "demo dashboard widget: returns static canned data with no per-user or " +
            "tenant scoping; any signed-in user may query it",
        },
      },
    },
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
    {
      access: {
        openToAll: {
          reason:
            "demo dashboard widget: returns static canned data with no per-user or " +
            "tenant scoping; any signed-in user may query it",
        },
      },
    },
  );
  r.queryHandler(
    "metrics:upcoming-events",
    z.object({}),
    async (_query, ctx) => ({
      rows: [
        {
          primary: demoText("widgets:dashboard:demo-event-rate-adjustment", ctx.locale),
          trailing: demoMonthYear(2026, 8, ctx.locale),
        },
        {
          primary: demoText("widgets:dashboard:demo-event-savings-contract", ctx.locale),
          trailing: demoMonthYear(2026, 10, ctx.locale),
        },
      ],
    }),
    {
      access: {
        openToAll: {
          reason:
            "demo dashboard widget: returns static canned data with no per-user or " +
            "tenant scoping; any signed-in user may query it",
        },
      },
    },
  );
  r.queryHandler(
    "metrics:goal-progress",
    z.object({}),
    async (_query, ctx) => ({
      rows: [
        {
          label: demoText("widgets:dashboard:demo-goal-mortgage", ctx.locale),
          value: openAmount(42000, ctx.locale),
          fraction: 0.71,
        },
        {
          label: demoText("widgets:dashboard:demo-goal-car-loan", ctx.locale),
          value: openAmount(3200, ctx.locale),
          fraction: 0.92,
        },
      ],
    }),
    {
      access: {
        openToAll: {
          reason:
            "demo dashboard widget: returns static canned data with no per-user or " +
            "tenant scoping; any signed-in user may query it",
        },
      },
    },
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
