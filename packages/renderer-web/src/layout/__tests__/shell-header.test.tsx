import { describe, expect, test } from "bun:test";
import type { AppSchema } from "@cosmicdrift/kumiko-renderer";
import { renderWithSidebar, screen } from "../../__tests__/test-utils";
import { ShellHeader } from "../shell-header";

const emptySchema: AppSchema = { features: [] };

describe("ShellHeader", () => {
  test("default: h-16, collapses to h-12 with the icon rail (unchanged regression)", () => {
    renderWithSidebar(<ShellHeader schema={emptySchema} />);
    const header = screen.getByRole("banner");
    expect(header.className).toContain("h-16");
    expect(header.className).toContain("group-has-data-[collapsible=icon]/sidebar-wrapper:h-12");
  });

  test('carries the data-kumiko-layout="shell-header" marker that drives --shell-header-height', () => {
    renderWithSidebar(<ShellHeader schema={emptySchema} />);
    const header = screen.getByRole("banner");
    expect(header.getAttribute("data-kumiko-layout")).toBe("shell-header");
  });
});
