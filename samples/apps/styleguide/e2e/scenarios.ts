import type { Page } from "@playwright/test";

// Ein Eintrag = ein Styleguide-Block = ein Screenshot (×3 Themes). Baseline:
// die zwei realen Auto-UI-Screens (Edit-Form-in-Card + Liste mit Toolbar/
// Pagination), beide zeigen Shell + Sidebar-Nav mit. Foundations-Swatches +
// apex_shell kommen als eigene Blöcke dazu, sobald die Pipeline steht.

export interface Scenario {
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly waitFor: string;
  readonly settleMs?: number;
  readonly fullPage?: boolean;
  readonly flow?: (page: Page) => Promise<void>;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "gallery",
    description: "Foundations + Components: Colors, Typography, Buttons, Cards, Radius, Elevation",
    url: "/gallery",
    waitFor: "[data-testid='sg-colors']",
    settleMs: 400,
    fullPage: true,
  },
  {
    name: "edit",
    description: "Entity-Edit: Form in Card-Sections, alle Feldtypen, Buttons",
    url: "/item-edit",
    waitFor: "text=Text",
    settleMs: 400,
    fullPage: true,
  },
  {
    name: "list",
    description: "Entity-List: Toolbar, Rows, Row-Actions, Pagination, Sidebar-Nav",
    url: "/item-list",
    waitFor: "text=Demo item #1",
    settleMs: 400,
    fullPage: true,
  },
  {
    name: "shipping",
    description: "Config-Stresstest: shadcn Shipping-Address aus dem Schema (flache Form)",
    url: "/shipping-edit",
    waitFor: "text=Shipping Address",
    settleMs: 400,
    fullPage: true,
  },
  {
    name: "profile",
    description: "Config-Stresstest: Profile mit Avatar-Image-Upload-Feld",
    url: "/profile-edit",
    waitFor: "text=Full name",
    settleMs: 400,
    fullPage: true,
  },
];
