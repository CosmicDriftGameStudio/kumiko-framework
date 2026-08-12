// WorkspaceSwitcher Render-Tests (Phase 1, test-luecken-integration, Tier 2).
//
// Dropdown built on Radix (like LanguageSwitcher/TenantSwitcher). Pins:
// no switcher at <= 1 workspace, trigger shows the active label, dropdown
// lists all workspaces with aria-checked on the active one, onSelect
// callback. Radix opens on pointerdown → userEvent instead of
// fireEvent.click, same as language-switcher.test.tsx.

import { describe, expect, mock, spyOn, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  type WorkspaceSchema,
} from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { render, renderWithSidebar, screen } from "../../__tests__/test-utils";
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

  test("entries carry role=menuitemradio (exclusive choice), not menuitemcheckbox", async () => {
    const user = userEvent.setup();
    renderWithSidebar(
      <WorkspaceSwitcher
        workspaces={[ws("a", "Alpha"), ws("b", "Beta")]}
        activeId="a"
        onSelect={() => {}}
      />,
    );
    await user.click(screen.getByTestId("workspace-switcher-trigger"));
    expect(screen.getByTestId("workspace-tab-a").getAttribute("role")).toBe("menuitemradio");
    expect(screen.getByTestId("workspace-tab-b").getAttribute("role")).toBe("menuitemradio");
  });

  test("trigger has an accessible name beyond the active workspace label", () => {
    renderWithSidebar(
      <WorkspaceSwitcher
        workspaces={[ws("a", "Alpha"), ws("b", "Beta")]}
        activeId="a"
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByTestId("workspace-switcher-trigger").getAttribute("aria-label"),
    ).toBeTruthy();
  });

  test("activeId zeigt auf keinen sichtbaren Workspace → Trigger zeigt Fallback-Label statt leerem span (fw#1816)", () => {
    renderWithSidebar(
      <WorkspaceSwitcher
        workspaces={[ws("a", "Alpha"), ws("b", "Beta")]}
        activeId="stale-id-not-in-list"
        onSelect={() => {}}
        testId="sw"
      />,
    );
    expect(screen.getByTestId("sw").textContent).not.toBe("");
    expect(screen.getByText("Select workspace")).toBeTruthy();
  });

  test("rendering outside a SidebarProvider throws — the JSDoc requirement is a real crash, not just documentation (fw#1816)", () => {
    // SidebarMenuButton calls useSidebar() internally; without a
    // SidebarProvider ancestor that throws synchronously during render.
    // Silence the expected console.error noise React logs alongside it.
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() =>
        render(
          <WorkspaceSwitcher
            workspaces={[ws("a", "Alpha"), ws("b", "Beta")]}
            activeId="a"
            onSelect={() => {}}
          />,
        ),
      ).toThrow(/useSidebar must be used within a SidebarProvider/);
    } finally {
      consoleError.mockRestore();
    }
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
    // Trigger shows the translated active label.
    expect(screen.getByText("Admin Area")).toBeTruthy();
    await user.click(screen.getByTestId("workspace-switcher-trigger"));
    // No dot: verbatim, no t() roundtrip.
    expect(screen.getByTestId("workspace-tab-b").textContent).toBe("Plain Label");
  });
});
