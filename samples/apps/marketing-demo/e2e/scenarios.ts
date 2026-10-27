// Marketing screenshot scenarios.
//
// Each case is a deliberate marketing story — it proves a USP
// visually. A new entry = a new PNG on the next `bun screenshots`.

import type { Scenario } from "@cosmicdrift/kumiko-testing/e2e";

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "asset-list",
    description:
      "Asset tracker — data table with a status column (available / on loan / in maintenance)",
    url: "/asset-list",
    waitFor: "table tbody tr",
  },
  {
    name: "asset-edit",
    description:
      "Schema-driven edit form — master data and assignment sections, status dropdown, date field. Generated from the entity",
    flow: async (page) => {
      await page.goto("/asset-list");
      await page.locator("table tbody tr").first().waitFor({ state: "visible" });
      await page.locator("table tbody tr").first().click();
      await page.waitForURL(/\/asset-edit/);
    },
    waitFor: "form input, [data-testid='field-name']",
  },
  {
    name: "ticket-list",
    description:
      "Helpdesk — a second app on the same platform. Severity default sort, schema-driven, same look as assets",
    url: "/ticket-list",
    waitFor: "table tbody tr",
  },
  {
    name: "ticket-edit",
    description: "Ticket form — severity and status selects, multi-section layout, person fields",
    flow: async (page) => {
      await page.goto("/ticket-list");
      await page.locator("table tbody tr").first().waitFor({ state: "visible" });
      await page.locator("table tbody tr").first().click();
      await page.waitForURL(/\/ticket-edit/);
    },
    waitFor: "form input, [data-testid='field-title']",
  },
];
