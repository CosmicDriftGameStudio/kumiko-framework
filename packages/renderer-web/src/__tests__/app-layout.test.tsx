// AppLayout: pinnt den fill-Vertrag — Default ist der klassische
// min-h-screen-Seitenflow, fill schaltet auf h-screen + innen-scrollendes
// main (min-h-0). Plus die className/mainClassName-Erweiterungspunkte.

import { describe, expect, test } from "bun:test";
import { AppLayout } from "../layout/app-layout";
import { render } from "./test-utils";

function root(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-kumiko-layout="app"]');
  if (el === null) throw new Error("AppLayout root not found");
  return el as HTMLElement;
}

describe("AppLayout fill", () => {
  test("Default → min-h-screen (Seiten-Scroll), kein fill-Marker", () => {
    const { container } = render(<AppLayout>x</AppLayout>);
    const el = root(container);
    expect(el.className).toContain("min-h-screen");
    expect(el.getAttribute("data-kumiko-fill")).toBeNull();
    expect((container.querySelector("main") as HTMLElement).className).not.toContain("min-h-0");
  });

  test("fill → h-screen + main min-h-0 (Innen-Scroll), fill-Marker gesetzt", () => {
    const { container } = render(<AppLayout fill>x</AppLayout>);
    const el = root(container);
    expect(el.className).not.toContain("min-h-screen");
    expect(el.className).toContain("h-screen");
    expect(el.getAttribute("data-kumiko-fill")).toBe("true");
    expect((container.querySelector("main") as HTMLElement).className).toContain("min-h-0");
  });

  test("className/mainClassName werden an die Defaults angehängt", () => {
    const { container } = render(
      <AppLayout className="bg-gradient-test" mainClassName="main-test">
        x
      </AppLayout>,
    );
    expect(root(container).className).toContain("bg-gradient-test");
    expect(root(container).className).toContain("flex");
    expect((container.querySelector("main") as HTMLElement).className).toContain("main-test");
  });
});
