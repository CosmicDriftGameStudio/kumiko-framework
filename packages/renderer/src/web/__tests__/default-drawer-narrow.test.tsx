import { describe, expect, test } from "bun:test";
import { DefaultDrawer as Drawer } from "../primitives/drawer.tsx";
import { atViewportWidth, render, screen } from "./test-utils.tsx";

function panel(): HTMLElement {
  return screen.getByTestId("demo-drawer");
}

describe("DefaultDrawer on a phone", () => {
  test("opens full screen from the right instead of as a bottom sheet", () => {
    atViewportWidth(390, () => {
      render(
        <Drawer open onOpenChange={() => {}} title="Reply" testId="demo-drawer">
          <p>body</p>
        </Drawer>,
      );
      expect(panel().className).toContain("inset-0");
      expect(panel().className).not.toContain("max-h-[90vh]");
      expect(panel().className).not.toContain("bottom-0");
    });
  });

  test("keeps the right side panel on the page background on a wide viewport", () => {
    atViewportWidth(1280, () => {
      render(
        <Drawer open onOpenChange={() => {}} title="Reply" testId="demo-drawer">
          <p>body</p>
        </Drawer>,
      );
      expect(panel().className).not.toContain("max-h-[90vh]");
      expect(panel().className).toContain("right-0");
      expect(panel().className).toContain("max(600px,37.5vw)");
      expect(panel().className).toContain("bg-background");
    });
  });
});
