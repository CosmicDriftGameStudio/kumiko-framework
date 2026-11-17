// Widgets-Feature (server). Zwei Screens:
//   widgets           — custom Katalog-Screen (alle Widgets mit statischen Daten)
//   widgets-dashboard — deklarativer dashboard-Screen (stat/chart/list-Panels
//                       aus Demo-Queries) — der Schema-getriebene Gegenpart.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import {
  INBOX_MESSAGES,
  LOAN_MARKERS,
  LOAN_MONTHS,
  LOAN_SERIES,
  LOAN_START_MS,
  LOAN_TODAY_MS,
  loanMonthMs,
  openAmount,
  RESPONSE_POINTS,
} from "./demo-data";
import { demoMoney, demoMonthYear, demoPercent, demoText } from "./demo-locale";
import { WIDGETS_I18N } from "./i18n";
import { widgetsDashboardScreen } from "./screens";

export const widgetsFeature = defineFeature("widgets", (r) => {
  r.screen({ id: "widgets", type: "custom", renderer: { react: { __component: "widgets" } } });
  r.screen({
    id: "widgets-forms",
    type: "custom",
    renderer: { react: { __component: "widgets-forms" } },
  });

  r.screen(widgetsDashboardScreen);

  r.queryHandler({
    name: "metrics:portfolio-stat",
    schema: z.object({ region: z.string().optional() }),
    handler: async ({ payload: { region } }, ctx) => ({
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
    access: {
      openToAll: {
        reason:
          "demo dashboard widget: returns static canned data with no per-user or " +
          "tenant scoping; any signed-in user may query it",
      },
    },
  });
  r.queryHandler({
    name: "metrics:net-worth-assets",
    schema: z.object({ region: z.string().optional() }),
    handler: async (_query, ctx) => ({ value: demoMoney(120000, "EUR", ctx.locale) }),
    access: {
      openToAll: {
        reason:
          "demo dashboard widget: returns static canned data with no per-user or " +
          "tenant scoping; any signed-in user may query it",
      },
    },
  });
  r.queryHandler({
    name: "metrics:net-worth-debts",
    schema: z.object({ region: z.string().optional() }),
    handler: async (_query, ctx) => ({ value: demoMoney(65370, "EUR", ctx.locale) }),
    access: {
      openToAll: {
        reason:
          "demo dashboard widget: returns static canned data with no per-user or " +
          "tenant scoping; any signed-in user may query it",
      },
    },
  });
  r.queryHandler({
    name: "metrics:response-times",
    schema: z.object({}),
    handler: async () => ({
      points: RESPONSE_POINTS,
      windowStartMs: 0,
      windowEndMs: 24 * 60 * 60 * 1000,
    }),
    access: {
      openToAll: {
        reason:
          "demo dashboard widget: returns static canned data with no per-user or " +
          "tenant scoping; any signed-in user may query it",
      },
    },
  });
  r.queryHandler({
    name: "metrics:loan",
    schema: z.object({}),
    handler: async () => ({
      series: LOAN_SERIES,
      markers: LOAN_MARKERS,
      windowStartMs: LOAN_START_MS,
      windowEndMs: loanMonthMs(LOAN_MONTHS),
      todayMs: LOAN_TODAY_MS,
    }),
    access: {
      openToAll: {
        reason:
          "demo dashboard widget: returns static canned data with no per-user or " +
          "tenant scoping; any signed-in user may query it",
      },
    },
  });
  r.queryHandler({
    name: "metrics:latest-items",
    schema: z.object({}),
    handler: async (_query, ctx) => ({
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
    access: {
      openToAll: {
        reason:
          "demo dashboard widget: returns static canned data with no per-user or " +
          "tenant scoping; any signed-in user may query it",
      },
    },
  });
  r.queryHandler({
    name: "metrics:inbox-messages",
    schema: z.object({
      cursor: z.coerce.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      unreadOnly: z.boolean().optional(),
      search: z.string().optional(),
    }),
    handler: async ({ payload: { cursor, limit, unreadOnly, search } }) => {
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
    access: {
      openToAll: {
        reason:
          "demo dashboard widget: returns static canned data with no per-user or " +
          "tenant scoping; any signed-in user may query it",
      },
    },
  });
  r.queryHandler({
    name: "metrics:upcoming-events",
    schema: z.object({}),
    handler: async (_query, ctx) => ({
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
    access: {
      openToAll: {
        reason:
          "demo dashboard widget: returns static canned data with no per-user or " +
          "tenant scoping; any signed-in user may query it",
      },
    },
  });
  r.queryHandler({
    name: "metrics:goal-progress",
    schema: z.object({}),
    handler: async (_query, ctx) => ({
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
        { label: { i18nKey: "widgets:dashboard:demo-cap-users" }, used: 10, limit: 10 },
        { label: { i18nKey: "widgets:dashboard:demo-cap-projects" }, used: 4, limit: null },
      ],
    }),
    access: {
      openToAll: {
        reason:
          "demo dashboard widget: returns static canned data with no per-user or " +
          "tenant scoping; any signed-in user may query it",
      },
    },
  });

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
