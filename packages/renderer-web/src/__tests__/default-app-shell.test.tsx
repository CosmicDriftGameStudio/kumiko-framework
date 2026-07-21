//
// DefaultAppShell — pinnt dass user-prop an NavTree durchgereicht wird.
//
// Prod-Bug 2026-05-02: DefaultAppShell hatte user-prop NICHT, sysadmin
// sah keine SystemAdmin-only nav-einträge (resolveNavigation behandelte
// fehlende user als anonymous → alle role-gated navs ausgeblendet). Test
// pinst dass DefaultAppShell user nun akzeptiert UND durchreicht.

import { describe, expect, test } from "bun:test";
import type { EntityListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen } from "@cosmicdrift/kumiko-renderer";
import { DefaultAppShell } from "../layout/default-app-shell";
import { createMockDispatcher, render, screen } from "./test-utils";

function makeSchema(): FeatureSchema {
  return {
    featureName: "showcase",
    entities: {},
    screens: [
      { id: "public-screen", type: "entityList", entity: "x", columns: [] },
      { id: "sysadmin-screen", type: "entityList", entity: "x", columns: [] },
    ],
    navs: [
      { id: "public", label: "Public", screen: "public-screen", order: 10 },
      {
        id: "sysadmin",
        label: "Sysadmin",
        screen: "sysadmin-screen",
        order: 20,
        access: { roles: ["SystemAdmin"] },
      },
    ],
  } as FeatureSchema;
}

describe("DefaultAppShell user-prop forwarding", () => {
  test("OHNE user-prop → role-gated nav unsichtbar (= prod-bug-vor-fix)", () => {
    render(
      <DefaultAppShell brand={<span>Brand</span>} schema={makeSchema()}>
        <div>content</div>
      </DefaultAppShell>,
    );
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.queryByText("Sysadmin")).toBeNull();
  });

  test("MIT user-prop SystemAdmin → sysadmin-nav sichtbar", () => {
    render(
      <DefaultAppShell
        brand={<span>Brand</span>}
        schema={makeSchema()}
        user={{ id: "u1", roles: ["SystemAdmin", "User"] }}
      >
        <div>content</div>
      </DefaultAppShell>,
    );
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Sysadmin")).toBeTruthy();
  });
});

describe("DefaultAppShell headerActions-Slot (Topbar rechts)", () => {
  test("headerActions rendern rechtsbündig im Topbar-Header", () => {
    render(
      <DefaultAppShell
        brand={<span>Brand</span>}
        schema={makeSchema()}
        headerActions={<button type="button">Theme</button>}
      >
        <div>content</div>
      </DefaultAppShell>,
    );
    const slot = document.querySelector("[data-kumiko-layout='header-actions']");
    expect(slot).toBeTruthy();
    expect(slot?.className).toContain("ml-auto");
    expect(slot?.textContent).toBe("Theme");
  });

  test("ohne headerActions → kein Slot (keine leere Zelle)", () => {
    render(
      <DefaultAppShell brand={<span>Brand</span>} schema={makeSchema()}>
        <div>content</div>
      </DefaultAppShell>,
    );
    expect(document.querySelector("[data-kumiko-layout='header-actions']")).toBeNull();
  });
});

// DefaultAppShell threads `user.roles` into a UserRolesProvider around
// children (#1203) — KumikoScreen reads that to gate role-restricted
// screens at render time, not just in nav.
describe("DefaultAppShell wires user.roles into children for screen-level access (#1203)", () => {
  const restrictedScreen: EntityListScreenDefinition = {
    id: "restricted",
    type: "entityList",
    entity: "x",
    columns: [],
    access: { roles: ["SystemAdmin"] },
  };
  const restrictedSchema: FeatureSchema = {
    featureName: "showcase",
    entities: {},
    screens: [restrictedScreen],
  } as FeatureSchema;

  test("no user prop → role-gated screen child shows access-denied", () => {
    render(
      <DispatcherProvider dispatcher={createMockDispatcher()}>
        <DefaultAppShell brand={<span>Brand</span>} schema={restrictedSchema}>
          <KumikoScreen schema={restrictedSchema} qn="showcase:screen:restricted" />
        </DefaultAppShell>
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("kumiko-screen-access-denied")).toBeTruthy();
  });

  test("user prop with matching role → role-gated screen child renders", () => {
    render(
      <DispatcherProvider dispatcher={createMockDispatcher()}>
        <DefaultAppShell
          brand={<span>Brand</span>}
          schema={restrictedSchema}
          user={{ id: "u1", roles: ["SystemAdmin"] }}
        >
          <KumikoScreen schema={restrictedSchema} qn="showcase:screen:restricted" />
        </DefaultAppShell>
      </DispatcherProvider>,
    );
    expect(screen.queryByTestId("kumiko-screen-access-denied")).toBeNull();
  });
});
