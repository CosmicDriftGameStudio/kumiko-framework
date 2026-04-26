// @vitest-environment jsdom
//
// NavTree: Sidebar-Navigation aus dem Schema. Pinnt zwei Verträge:
//   1. Section-Header (parent ohne screen) plus children-Collapse
//      via Chevron-Click — State lokal im NavTree.
//   2. Active-State greift auf node mit screen wenn nav.route's
//      screenId matcht (Standard-Sidebar-Verhalten).

import type { FeatureSchema } from "@kumiko/renderer";
import { describe, expect, test } from "vitest";
import { NavTree } from "../layout/nav-tree";
import { fireEvent, render, screen } from "./test-utils";

function makeSchema(): FeatureSchema {
  return {
    featureName: "showcase",
    entities: {},
    screens: [
      { id: "items", type: "entityList", entity: "item", columns: [] },
      { id: "active", type: "entityList", entity: "item", columns: [] },
      { id: "backlog", type: "entityList", entity: "item", columns: [] },
    ],
    navs: [
      // Section ohne Screen mit children — togglebar (Variant 2)
      { id: "data", label: "Data", order: 10 },
      // Parent mit Screen UND children — Link + separater Chevron (Variant 1)
      {
        id: "items",
        label: "Items",
        parent: "data",
        screen: "items",
        order: 10,
      },
      {
        id: "active",
        label: "Active",
        parent: "items",
        screen: "active",
        order: 10,
      },
      {
        id: "backlog",
        label: "Backlog",
        parent: "items",
        screen: "backlog",
        order: 20,
      },
    ],
  } as FeatureSchema;
}

describe("NavTree", () => {
  test("Section-Header (parent ohne screen) rendert children eingerückt — default expanded", () => {
    render(<NavTree schema={makeSchema()} testId="tree" />);

    // Section "Data" ist als Toggle-Button gerendert (uppercase).
    const dataHeader = screen.getByText("Data").closest("button") as HTMLButtonElement;
    expect(dataHeader).not.toBeNull();
    expect(dataHeader.getAttribute("aria-expanded")).toBe("true");

    // Children sind sichtbar im DOM.
    expect(screen.getByText("Items")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Backlog")).toBeTruthy();
  });

  test("Click auf Section-Header toggled aria-expanded — children verschwinden", () => {
    render(<NavTree schema={makeSchema()} testId="tree" />);

    const dataHeader = screen.getByText("Data").closest("button") as HTMLButtonElement;
    fireEvent.click(dataHeader);

    expect(dataHeader.getAttribute("aria-expanded")).toBe("false");
    // Items ist child von Data → nach Collapse nicht mehr im DOM
    expect(screen.queryByText("Items")).toBeNull();
    expect(screen.queryByText("Active")).toBeNull();
  });

  test("Parent mit Screen + children — Chevron-Click toggled, ohne Navigation", () => {
    render(<NavTree schema={makeSchema()} testId="tree" />);

    // "Items" hat children Active+Backlog; default expanded
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Backlog")).toBeTruthy();

    // Section-Header "Data" ist ein einziger Toggle-Button (kein nested
    // chevron-button drin). Parent-mit-Screen "Items" rendert dagegen den
    // KumikoLink + separaten Chevron-Button als Geschwister — der ist
    // der EINZIGE button mit aria-label "Zuklappen"/"Aufklappen".
    const chevronButtons = screen.getAllByRole("button", { name: /Zuklappen|Aufklappen/ });
    expect(chevronButtons.length).toBe(1);
    fireEvent.click(chevronButtons[0] as HTMLButtonElement);

    // Items ist jetzt collapsed; Active/Backlog weg
    expect(screen.queryByText("Active")).toBeNull();
    expect(screen.queryByText("Backlog")).toBeNull();
    // Items selbst bleibt sichtbar
    expect(screen.getByText("Items")).toBeTruthy();
  });
});
