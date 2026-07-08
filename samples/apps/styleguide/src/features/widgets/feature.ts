// Widgets-Feature (server). Zwei Screens:
//   widgets           — custom Katalog-Screen (alle Widgets mit statischen Daten)
//   widgets-dashboard — deklarativer dashboard-Screen (stat/chart/list-Panels
//                       aus Demo-Queries) — der Schema-getriebene Gegenpart.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

// Statische Demo-Zeitreihe (48 Punkte à 30 Minuten) — kein Date-API,
// das Fenster ist relativ zu 0 definiert.
const RESPONSE_POINTS = Array.from({ length: 48 }, (_, i) => ({
  atMs: i * 30 * 60 * 1000,
  value: i === 20 ? null : 120 + Math.round(80 * Math.abs(Math.sin(i / 5))),
}));

export const widgetsFeature = defineFeature("widgets", (r) => {
  r.screen({ id: "widgets", type: "custom", renderer: { react: { __component: "widgets" } } });

  r.screen({
    id: "widgets-dashboard",
    type: "dashboard",
    panels: [
      {
        kind: "stat",
        id: "portfolio",
        label: "widgets:dashboard:portfolio",
        query: "widgets:query:metrics:portfolio-stat",
        valueField: "value",
        subField: "sub",
        toneField: "tone",
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
    ],
  });

  r.queryHandler(
    "metrics:portfolio-stat",
    z.object({}),
    async () => ({ value: "92.753 €", sub: "über 4 Konten", tone: "positive" }),
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

  r.translations({
    keys: {
      "screen:widgets.title": { de: "Widgets", en: "Widgets" },
      "screen:widgets-dashboard.title": {
        de: "Dashboard (deklarativ)",
        en: "Dashboard (declarative)",
      },
      "widgets:dashboard:portfolio": { de: "Portfolio", en: "Portfolio" },
      "widgets:dashboard:response-times": { de: "Antwortzeit", en: "Response time" },
      "widgets:dashboard:latest": { de: "Neueste Ereignisse", en: "Latest events" },
      "widgets:dashboard:col-name": { de: "Name", en: "Name" },
      "widgets:dashboard:col-status": { de: "Status", en: "Status" },
    },
  });

  r.nav({
    id: "widgets",
    label: "Widgets",
    parent: "gallery:nav:styleguide",
    screen: "widgets:screen:widgets",
    icon: "layout-grid",
    order: 20,
  });
  r.nav({
    id: "widgets-dashboard",
    label: "Dashboard (deklarativ)",
    parent: "gallery:nav:styleguide",
    screen: "widgets:screen:widgets-dashboard",
    icon: "gauge",
    order: 21,
  });
});
