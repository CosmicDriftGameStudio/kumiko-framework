// Marketing-Screenshot-Szenarien für die kumiko.rocks-Site.
//
// Jeder Case ist eine bewusste Marketing-Story — beweist eine USP
// visuell. Neuer Eintrag = neues PNG beim nächsten `yarn screenshots`.

import type { Page } from "@playwright/test";

export interface Scenario {
  readonly name: string;
  readonly description: string;
  readonly url?: string;
  readonly flow?: (page: Page) => Promise<void>;
  readonly waitFor?: string;
  readonly settleMs?: number;
  readonly fullPage?: boolean;
  readonly viewport?: { readonly width: number; readonly height: number };
}

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "asset-list",
    description:
      "Asset-Tracker — DataTable mit Status-Spalte (verfügbar / ausgeliehen / in Wartung), DACH-Persona-Beweis",
    url: "/asset-list",
    waitFor: "table tbody tr",
    settleMs: 500,
  },
  {
    name: "asset-edit",
    description:
      "Schema-driven Edit-Form — Stammdaten + Zuordnung Sections, Status-Dropdown, Datums-Field. Auto-generiert aus Entity",
    flow: async (page) => {
      await page.goto("/asset-list");
      await page.locator("table tbody tr").first().waitFor({ state: "visible" });
      await page.locator("table tbody tr").first().click();
      await page.waitForURL(/\/asset-edit/);
    },
    waitFor: "form input, [data-testid='field-name']",
    settleMs: 400,
  },
  {
    name: "ticket-list",
    description:
      "Helpdesk — zweite App auf gleicher Plattform. Severity-Default-Sort, Schema-driven, gleicher Look wie Assets",
    url: "/ticket-list",
    waitFor: "table tbody tr",
    settleMs: 500,
  },
  {
    name: "ticket-edit",
    description: "Ticket-Form — Severity- + Status-Selects, Multi-Section-Layout, Personen-Felder",
    flow: async (page) => {
      await page.goto("/ticket-list");
      await page.locator("table tbody tr").first().waitFor({ state: "visible" });
      await page.locator("table tbody tr").first().click();
      await page.waitForURL(/\/ticket-edit/);
    },
    waitFor: "form input, [data-testid='field-title']",
    settleMs: 400,
  },
];
