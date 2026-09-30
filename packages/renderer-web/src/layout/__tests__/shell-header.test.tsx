import { describe, expect, test } from "bun:test";
import type { AppSchema } from "@cosmicdrift/kumiko-renderer";
import { renderWithSidebar, screen } from "../../__tests__/test-utils";
import { ShellHeader } from "../shell-header";

const emptySchema: AppSchema = { features: [] };

describe("ShellHeader", () => {
  test("is 56px (h-14) and does not shrink with the icon rail", () => {
    renderWithSidebar(<ShellHeader schema={emptySchema} />);
    const header = screen.getByRole("banner");
    expect(header.className).toContain("h-14");
    expect(header.className).not.toContain("sidebar-wrapper:h-12");
  });

  test('carries the data-kumiko-layout="shell-header" marker that drives --shell-header-height', () => {
    renderWithSidebar(<ShellHeader schema={emptySchema} />);
    const header = screen.getByRole("banner");
    expect(header.getAttribute("data-kumiko-layout")).toBe("shell-header");
  });
});
