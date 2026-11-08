import { describe, expect, test } from "bun:test";
import { DefaultDrawer as Drawer } from "../primitives/drawer.tsx";
import { atViewportWidth, render, screen } from "./test-utils.tsx";

function panel(): HTMLElement {
  return screen.getByTestId("demo-drawer");
}

describe("DefaultDrawer on a phone", () => {
  test("opens as a bottom sheet capped below full height", () => {
    atViewportWidth(390, () => {
      render(
        <Drawer open onOpenChange={() => {}} title="Reply" testId="demo-drawer">
          <p>body</p>
        </Drawer>,
      );
      expect(panel().className).toContain("bottom-0");
      expect(panel().className).toContain("max-h-[90vh]");
    });
  });

  test("keeps the right side panel on a wide viewport", () => {
    atViewportWidth(1280, () => {
      render(
        <Drawer open onOpenChange={() => {}} title="Reply" testId="demo-drawer">
          <p>body</p>
        </Drawer>,
      );
      expect(panel().className).not.toContain("max-h-[90vh]");
      expect(panel().className).toContain("right-0");
    });
  });
});
