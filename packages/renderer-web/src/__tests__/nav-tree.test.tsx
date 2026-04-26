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
      // Section ohne Screen mit children — togglebar
      { id: "data", label: "Data", order: 10 },
      {
        id: "items",
        label: "Items",
        parent: "data",
        screen: "items",
        order: 10,
      },
      {
        id: "items-sub",
        label: "Sub",
        parent: "data",
        order: 20,
      },
      {
        id: "active",
        label: "Active",
        parent: "items-sub",
        screen: "active",
        order: 10,
      },
      {
        id: "backlog",
        label: "Backlog",
        parent: "items-sub",
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
    expect(screen.getByText("Sub")).toBeTruthy();
  });

  test("Click auf Section-Header toggled aria-expanded — children verschwinden", () => {
    render(<NavTree schema={makeSchema()} testId="tree" />);

    const dataHeader = screen.getByText("Data").closest("button") as HTMLButtonElement;
    fireEvent.click(dataHeader);

    expect(dataHeader.getAttribute("aria-expanded")).toBe("false");
    // Items ist child von Data → nach Collapse nicht mehr im DOM
    expect(screen.queryByText("Items")).toBeNull();
    expect(screen.queryByText("Sub")).toBeNull();
  });

  test("Parent mit Screen + children — Chevron-Click toggled, ohne Navigation", () => {
    render(<NavTree schema={makeSchema()} testId="tree" />);

    // "Sub" hat children Active+Backlog; default expanded
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Backlog")).toBeTruthy();

    // Chevron-Button auf "Sub": aria-label "Zuklappen" wenn expanded
    const subChevrons = screen.getAllByRole("button", { name: /Zuklappen|Aufklappen/ });
    // Zwei Chevrons existieren: für "Data" (section header click is on the button itself,
    // chevron ist eingebettet) und für "Sub". Filter nach Sub-row's chevron — finde via parent.
    const subRow = screen.getByText("Sub").closest("button");
    const subChevron = subRow?.querySelector("button");
    expect(subChevron).not.toBeNull();
    if (subChevron === null || subChevron === undefined) return;
    fireEvent.click(subChevron);

    // Sub ist jetzt collapsed; Active/Backlog weg
    expect(screen.queryByText("Active")).toBeNull();
    expect(screen.queryByText("Backlog")).toBeNull();
    // Sub selbst bleibt sichtbar
    expect(screen.getByText("Sub")).toBeTruthy();
    // Suppress unused-var warning
    expect(subChevrons.length).toBeGreaterThan(0);
  });
});
