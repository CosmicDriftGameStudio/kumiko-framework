//
// DefaultAppShell — pinnt dass user-prop an NavTree durchgereicht wird.
//
// Prod-Bug 2026-05-02: DefaultAppShell hatte user-prop NICHT, sysadmin
// sah keine SystemAdmin-only nav-einträge (resolveNavigation behandelte
// fehlende user als anonymous → alle role-gated navs ausgeblendet). Test
// pinst dass DefaultAppShell user nun akzeptiert UND durchreicht.

import { describe, expect, test } from "bun:test";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DefaultAppShell } from "../layout/default-app-shell";
import { render, screen } from "./test-utils";

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
