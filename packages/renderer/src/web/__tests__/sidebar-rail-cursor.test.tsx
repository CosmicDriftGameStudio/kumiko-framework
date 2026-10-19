import { describe, expect, test } from "bun:test";
import { SidebarRail } from "../ui/sidebar.tsx";
import { renderWithSidebar } from "./test-utils.tsx";

describe("SidebarRail", () => {
  test("is a click toggle, so it shows a pointer cursor and no resize cursor", () => {
    const { container } = renderWithSidebar(<SidebarRail />);
    const rail = container.querySelector("[data-slot='sidebar-rail']");
    expect(rail?.className).toContain("cursor-pointer");
    expect(rail?.className).not.toContain("resize");
    expect(rail?.className).not.toMatch(/cursor-[we]-resize/);
  });
});
