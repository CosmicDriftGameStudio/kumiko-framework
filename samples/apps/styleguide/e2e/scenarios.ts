import type { Scenario } from "@cosmicdrift/kumiko-testing/e2e";
import { FIRST_STYLEGUIDE_INSPECTION_ID, FIRST_STYLEGUIDE_ITEM_ID } from "../src/app/seed";

// One entry = one styleguide block = one screenshot (×locale×theme×viewport).
// Baseline: the two real auto-UI screens (edit form in card + list with
// toolbar/pagination), both show shell + sidebar nav. Foundations
// swatches + apex_shell join as their own blocks once the pipeline is in place.

const DASHBOARD_FROZEN_NOW = "2026-06-15T12:00:00Z";

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "gallery",
    description: "Foundations + Components: Colors, Typography, Buttons, Cards, Radius, Elevation",
    url: "/gallery",
    waitFor: "[data-testid='sg-colors']",
    fullPage: true,
  },
  {
    name: "edit",
    description: "Entity-Edit: Form in Card-Sections, alle Feldtypen, Buttons",
    url: "/item-edit",
    waitFor: "text=Text",
    fullPage: true,
  },
  {
    name: "edit-existing",
    description: "Entity-Edit Update-Mode: Header-Actions (icon-only), gefüllte Felder",
    url: `/item-edit/${FIRST_STYLEGUIDE_ITEM_ID}`,
    waitFor: "text=Text",
    fullPage: true,
  },
  {
    name: "list",
    description: "Entity-List: Toolbar, Rows, Row-Actions, Pagination, Sidebar-Nav",
    url: "/item-list",
    waitFor: "text=Demo item #1",
    fullPage: true,
  },
  {
    name: "shipping",
    description: "Config-Stresstest: shadcn Shipping-Address aus dem Schema (flache Form)",
    url: "/shipping-edit",
    waitFor: "text=Shipping Address",
    fullPage: true,
  },
  {
    name: "profile",
    description: "Config-Stresstest: Profile mit Avatar-Image-Upload-Feld",
    url: "/profile-edit",
    waitFor: "[name='fullName']",
    fullPage: true,
  },
  {
    name: "located-timestamp",
    description:
      "Timezones-Recipe: locatedTimestamp-Picker (Wall-Clock + IANA-Zone) + date/timestamp/tz",
    url: "/delivery-edit",
    waitFor: "text=Located date-time",
    fullPage: true,
  },
  {
    name: "inspection-checklist-mobile",
    description:
      "Inspection checklist as phone cards: tone segments, finding on not_ok, photo tile",
    url: `/inspection-edit/${FIRST_STYLEGUIDE_INSPECTION_ID}`,
    viewport: { width: 390, height: 844 },
    waitFor: "text=Hydraulic hose intact",
    fullPage: true,
    // The shell scrolls internally, so fullPage alone stops at the viewport and hides cards 3 and 4.
    captureStyle:
      "html, body, #root, .h-svh, .h-dvh, .h-screen { height: auto !important; } .overflow-y-auto, .overflow-auto { overflow: visible !important; }",
  },
  {
    name: "inspection-checklist",
    description: "Inspection checklist as desktop table with per-row hidden cells and tone badges",
    url: `/inspection-edit/${FIRST_STYLEGUIDE_INSPECTION_ID}`,
    waitFor: "text=Hydraulic hose intact",
    fullPage: true,
  },
  {
    name: "widgets-forms",
    description:
      "Form templates: CRM/maintenance/patient intake/incident log — SectionCard+Grid responsive across viewports",
    url: "/widgets-forms",
    waitFor: "[data-testid='form-examples-page']",
    fullPage: true,
  },
  {
    name: "widgets",
    description: "Widget-Katalog: jedes Widget auf einer Seite (Stats, Charts, Forms, Inbox)",
    url: "/widgets",
    waitFor: "[data-testid='widgets-page']",
  },
  {
    name: "widgets-dashboard",
    description: "Declarative dashboard: stat, chart and list panels from schema",
    // Frozen clock and UTC: the "As of" stamp would otherwise change per run and per host zone.
    flow: async (page) => {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setTimezoneOverride", { timezoneId: "UTC" });
      await page.clock.setFixedTime(DASHBOARD_FROZEN_NOW);
      await page.goto("/widgets-dashboard");
    },
    waitFor: "[data-testid='dashboard-widgets-dashboard']",
    fullPage: true,
  },
];
