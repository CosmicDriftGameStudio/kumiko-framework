// SidebarPanel tone (fw bedienkonzept point 8): a screen list can carry the
// page's own content colors instead of always reading as shell navigation.

import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { SidebarPanel } from "../sidebar-panel";

describe("SidebarPanel — tone", () => {
  test("default (nav) keeps the shell's sidebar chrome classes", () => {
    render(
      <SidebarPanel>
        <div data-testid="child">rows</div>
      </SidebarPanel>,
    );
    const body = screen.getByTestId("child").parentElement;
    expect(body?.className).toContain("bg-sidebar");
    expect(body?.className).toContain("border-sidebar-border");
  });

  test("tone=surface drops the sidebar classes for content-colored ones", () => {
    render(
      <SidebarPanel tone="surface">
        <div data-testid="child">rows</div>
      </SidebarPanel>,
    );
    const body = screen.getByTestId("child").parentElement;
    expect(body?.className).toContain("bg-muted");
    expect(body?.className).toContain("border-border");
    expect(body?.className).not.toContain("bg-sidebar");
    expect(body?.className).not.toContain("border-sidebar-border");
  });
});
