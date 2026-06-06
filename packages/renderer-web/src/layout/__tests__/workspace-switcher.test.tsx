// WorkspaceSwitcher Render-Tests (Phase 1, test-luecken-integration, Tier 2).
//
// Dumb presentational component (kein Radix). Pinnt: kein Switcher bei
// <= 1 Workspace, tablist mit aria-selected am aktiven, onSelect-Callback.
// Nutzt useTranslation → über test-utils mit LocaleProvider gerendert.

import { describe, expect, mock, test } from "bun:test";
import type { WorkspaceSchema } from "@cosmicdrift/kumiko-renderer";
import { fireEvent, render, screen } from "../../__tests__/test-utils";
import { WorkspaceSwitcher } from "../workspace-switcher";

function ws(id: string, label = id): WorkspaceSchema {
  return { definition: { id, label }, navMembers: [] };
}

describe("WorkspaceSwitcher — Render", () => {
  test("ein einziger Workspace → rendert nichts (kein nutzloser Switcher)", () => {
    const { container } = render(
      <WorkspaceSwitcher workspaces={[ws("a")]} activeId="a" onSelect={() => {}} />,
    );
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });

  test("mehrere Workspaces → tablist, aria-selected am aktiven Tab", () => {
    render(
      <WorkspaceSwitcher
        workspaces={[ws("a", "Alpha"), ws("b", "Beta")]}
        activeId="b"
        onSelect={() => {}}
        testId="sw"
      />,
    );
    expect(screen.getByTestId("sw").getAttribute("role")).toBe("tablist");
    expect(screen.getByTestId("workspace-tab-a").getAttribute("aria-selected")).toBe("false");
    expect(screen.getByTestId("workspace-tab-b").getAttribute("aria-selected")).toBe("true");
  });

  test("Click ruft onSelect mit der Workspace-id", () => {
    const onSelect = mock((_id: string) => {});
    render(
      <WorkspaceSwitcher
        workspaces={[ws("a", "Alpha"), ws("b", "Beta")]}
        activeId="a"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId("workspace-tab-b"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});
