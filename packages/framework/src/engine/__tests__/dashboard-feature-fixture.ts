import * as z from "zod";
import { defineFeature } from "../define-feature.ts";
import type { DashboardScreenDefinition } from "../types/screen.ts";
import { registerStubQueryHandler } from "./stub-query-handler.ts";

export const STAT_PANEL = {
  kind: "stat",
  id: "open-incidents",
  label: "demo:dashboard:panel:open-incidents",
  query: "demo:query:incident:open-count",
  valueField: "count",
} as const;

export function dashboardFeature(
  panels: DashboardScreenDefinition["panels"],
  filter?: DashboardScreenDefinition["filter"],
  extra: Partial<
    Pick<
      DashboardScreenDefinition,
      "timeRange" | "scope" | "record" | "actions" | "refresh" | "headerSubtitle"
    >
  > = {},
) {
  return defineFeature("demo", (r) => {
    registerStubQueryHandler(r, "folder:list");
    r.queryHandler({
      name: "incident:open-count",
      schema: z.object({}),
      handler: async () => ({ count: 3 }),
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    r.queryHandler({
      name: "incident:latest",
      schema: z.object({}),
      handler: async () => ({ rows: [], nextCursor: null }),
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    r.writeHandler({
      name: "recheck",
      schema: z.object({}),
      handler: async () => ({ isSuccess: true as const, data: {} }),
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    r.screen({
      id: "overview",
      type: "dashboard",
      panels,
      ...(filter !== undefined && { filter }),
      ...extra,
    });
    r.translations({
      keys: {
        "screen:overview.title": { de: "Übersicht", en: "Overview" },
        "demo:dashboard:panel:open-incidents": { de: "Offene Vorfälle", en: "Open incidents" },
        "demo:dashboard:panel:latest": { de: "Neueste", en: "Latest" },
        "demo:dashboard:col:name": { de: "Name", en: "Name" },
        "demo:dashboard:group:net-worth": { de: "Net Worth", en: "Net Worth" },
        "demo:dashboard:filter:region": { de: "Region", en: "Region" },
        "demo:dashboard:range:7d": { de: "7 Tage", en: "7 days" },
        "demo:dashboard:range:30d": { de: "30 Tage", en: "30 days" },
        "demo:dashboard:scope:badge": { de: "Alle Tenants", en: "All tenants" },
        "demo:dashboard:scope:notice": { de: "Hinweis", en: "Notice" },
        "demo:dashboard:chart:subtitle": { de: "7 Tage", en: "7 days" },
        "demo:dashboard:chart:empty": { de: "Leer", en: "Empty" },
        "demo:dashboard:chart:empty-hint": { de: "Später", en: "Later" },
        "demo:dashboard:action:send": { de: "Senden", en: "Send" },
      },
    });
  });
}
