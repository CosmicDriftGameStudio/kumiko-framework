// WorkspaceSwitcher Render-Tests (Phase 1, test-luecken-integration, Tier 2).
//
// Dropdown auf Radix-Basis (wie LanguageSwitcher/TenantSwitcher). Pinnt:
// kein Switcher bei <= 1 Workspace, Trigger zeigt aktives Label, Dropdown
// listet alle Workspaces mit aria-checked am aktiven, onSelect-Callback.
// Radix öffnet auf pointerdown → userEvent statt fireEvent.click, wie bei
// language-switcher.test.tsx.

import { describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  type WorkspaceSchema,
} from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { renderWithSidebar, screen } from "../../__tests__/test-utils";
import { WorkspaceSwitcher } from "../workspace-switcher";

function ws(id: string, label = id): WorkspaceSchema {
  return { definition: { id, label }, navMembers: [] };
}

describe("WorkspaceSwitcher — Render", () => {
  test("ein einziger Workspace → rendert nichts (kein nutzloser Switcher)", () => {
    const { container } = renderWithSidebar(
      <WorkspaceSwitcher workspaces={[ws("a")]} activeId="a" onSelect={() => {}} />,
    );
    expect(container.querySelector('[data-testid="workspace-switcher-trigger"]')).toBeNull();
  });

  test("mehrere Workspaces → Trigger zeigt aktives Label", () => {
    renderWithSidebar(
      <WorkspaceSwitcher
        workspaces={[ws("a", "Alpha"), ws("b", "Beta")]}
        activeId="b"
        onSelect={() => {}}
        testId="sw"
      />,
    );
    expect(screen.getByTestId("sw")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  test("Dropdown öffnen listet alle Workspaces, aria-checked am aktiven", async () => {
    const user = userEvent.setup();
    renderWithSidebar(
      <WorkspaceSwitcher
        workspaces={[ws("a", "Alpha"), ws("b", "Beta")]}
        activeId="b"
        onSelect={() => {}}
      />,
    );
    await user.click(screen.getByTestId("workspace-switcher-trigger"));
    expect(screen.getByTestId("workspace-tab-a").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("workspace-tab-b").getAttribute("aria-checked")).toBe("true");
  });

  test("Click auf einen Eintrag ruft onSelect mit der Workspace-id", async () => {
    const user = userEvent.setup();
    const onSelect = mock((_id: string) => {});
    renderWithSidebar(
      <WorkspaceSwitcher
        workspaces={[ws("a", "Alpha"), ws("b", "Beta")]}
        activeId="a"
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByTestId("workspace-switcher-trigger"));
    await user.click(screen.getByTestId("workspace-tab-b"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});

describe("WorkspaceSwitcher — i18n-Labels (Punkt-Konvention)", () => {
  test("Label mit Punkt geht durch t() und rendert die Übersetzung", async () => {
    const user = userEvent.setup();
    const bundle = { en: { "nav.adminArea": "Admin Area" } };
    renderWithSidebar(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "en" })}
        fallbackBundles={[bundle]}
      >
        <WorkspaceSwitcher
          workspaces={[ws("a", "nav.adminArea"), ws("b", "Plain Label")]}
          activeId="a"
          onSelect={mock()}
        />
      </LocaleProvider>,
    );
    // Trigger zeigt das übersetzte aktive Label.
    expect(screen.getByText("Admin Area")).toBeTruthy();
    await user.click(screen.getByTestId("workspace-switcher-trigger"));
    // ohne Punkt: verbatim, kein t()-Roundtrip
    expect(screen.getByTestId("workspace-tab-b").textContent).toBe("Plain Label");
  });
});
