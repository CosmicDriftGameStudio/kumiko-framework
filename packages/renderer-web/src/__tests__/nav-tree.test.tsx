//
// NavTree: Sidebar-Navigation aus dem Schema. Pinnt zwei Verträge:
//   1. Section-Header (parent ohne screen) plus children-Collapse
//      via Chevron-Click — State lokal im NavTree.
//   2. Active-State greift auf node mit screen wenn nav.route's
//      screenId matcht (Standard-Sidebar-Verhalten).

import { describe, expect, test } from "bun:test";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
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

function makeRoleGatedSchema(): FeatureSchema {
  return {
    featureName: "showcase",
    entities: {},
    screens: [
      { id: "public-screen", type: "entityList", entity: "x", columns: [] },
      { id: "admin-screen", type: "entityList", entity: "x", columns: [] },
      { id: "sysadmin-screen", type: "entityList", entity: "x", columns: [] },
    ],
    navs: [
      // Public — keine access-rule, sichtbar für alle (auch anonymous)
      { id: "public", label: "Public", screen: "public-screen", order: 10 },
      // Admin — nur User mit "Admin"-Rolle
      {
        id: "admin",
        label: "Admin",
        screen: "admin-screen",
        order: 20,
        access: { roles: ["Admin"] },
      },
      // Sysadmin — nur User mit "SystemAdmin"-Rolle
      {
        id: "sysadmin",
        label: "Sysadmin",
        screen: "sysadmin-screen",
        order: 30,
        access: { roles: ["SystemAdmin"] },
      },
    ],
  } as FeatureSchema;
}

describe("NavTree role-gating", () => {
  // Pinnt den prod-bug aus 2026-05-02: DefaultAppShell hat user-prop
  // nicht durchgereicht → resolveNavigation sieht user=undefined →
  // ALLE role-gated nav-einträge werden ausgeblendet (auch wenn der
  // user de-facto die Rolle hat).

  test("user mit ['SystemAdmin','User'] sieht public + sysadmin, NICHT admin", () => {
    render(
      <NavTree
        schema={makeRoleGatedSchema()}
        user={{ id: "u1", roles: ["SystemAdmin", "User"] }}
      />,
    );
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Sysadmin")).toBeTruthy();
    expect(screen.queryByText("Admin")).toBeNull();
  });

  test("user mit ['Admin'] sieht public + admin, NICHT sysadmin", () => {
    render(<NavTree schema={makeRoleGatedSchema()} user={{ id: "u1", roles: ["Admin"] }} />);
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Admin")).toBeTruthy();
    expect(screen.queryByText("Sysadmin")).toBeNull();
  });

  test("OHNE user-prop (anonymous) → role-gated navs ausgeblendet, nur public sichtbar", () => {
    // Genau das Verhalten das den prod-bug verursacht hat: wenn
    // DefaultAppShell user nicht weiterreicht, sieht resolveNavigation
    // anonymous → alle role-gated navs verschwinden.
    render(<NavTree schema={makeRoleGatedSchema()} />);
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.queryByText("Sysadmin")).toBeNull();
  });

  test("multi-role-merge: user mit überlappenden rollen sieht beide", () => {
    render(
      <NavTree
        schema={makeRoleGatedSchema()}
        user={{ id: "u1", roles: ["Admin", "SystemAdmin", "User"] }}
      />,
    );
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Admin")).toBeTruthy();
    expect(screen.getByText("Sysadmin")).toBeTruthy();
  });
});

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
    // aria-Label kommt aus dem Framework-Default-Bundle. Test-Setup
    // läuft auf "en" → "Expand"/"Collapse". Apps können das in eigenen
    // Bundles per `kumiko.nav.*` überschreiben.
    const chevronButtons = screen.getAllByRole("button", { name: /Expand|Collapse/ });
    expect(chevronButtons.length).toBe(1);
    fireEvent.click(chevronButtons[0] as HTMLButtonElement);

    // Items ist jetzt collapsed; Active/Backlog weg
    expect(screen.queryByText("Active")).toBeNull();
    expect(screen.queryByText("Backlog")).toBeNull();
    // Items selbst bleibt sichtbar
    expect(screen.getByText("Items")).toBeTruthy();
  });

  test("Nav-Eintrag mit bekanntem icon rendert ein Lucide-Icon, ohne icon den Dot", () => {
    const schema = {
      featureName: "showcase",
      entities: {},
      screens: [
        { id: "dash", type: "entityList", entity: "x", columns: [] },
        { id: "plain", type: "entityList", entity: "x", columns: [] },
      ],
      navs: [
        { id: "dash", label: "Dash", screen: "dash", order: 10, icon: "dashboard" },
        { id: "plain", label: "Plain", screen: "plain", order: 20 },
      ],
    } as FeatureSchema;
    const { container } = render(<NavTree schema={schema} />);
    // Flache Navigation ohne Sections → keine Chevrons. Genau EIN svg:
    // das dashboard-Icon. Das icon-lose Item rendert den Dot (span, kein svg).
    expect(container.querySelectorAll("svg").length).toBe(1);
  });

  test("unbekannter icon-Key fällt sauber auf den Dot zurück (kein svg)", () => {
    const schema = {
      featureName: "showcase",
      entities: {},
      screens: [{ id: "x", type: "entityList", entity: "x", columns: [] }],
      navs: [{ id: "x", label: "X", screen: "x", order: 10, icon: "does-not-exist" }],
    } as FeatureSchema;
    const { container } = render(<NavTree schema={schema} />);
    expect(container.querySelectorAll("svg").length).toBe(0);
  });
});
