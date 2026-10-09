// iOS Safari ignores interactive-widget=resizes-content, so fixed bottom bars follow
// window.visualViewport instead (fw#1959).

import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { StickyActionBar } from "../primitives/sticky-action-bar.js";
import { render, screen } from "./test-utils.js";

class FakeVisualViewport extends EventTarget {
  constructor(
    public height: number,
    public offsetTop = 0,
  ) {
    super();
  }
}

const originalDescriptor = Object.getOwnPropertyDescriptor(window, "visualViewport");

function installVisualViewport(value: FakeVisualViewport | undefined): void {
  Object.defineProperty(window, "visualViewport", { configurable: true, value });
}

afterEach(() => {
  if (originalDescriptor !== undefined) {
    Object.defineProperty(window, "visualViewport", originalDescriptor);
  } else {
    Reflect.deleteProperty(window, "visualViewport");
  }
});

function renderBar(): HTMLElement {
  render(
    <StickyActionBar testId="bar">
      <button type="button">Save</button>
    </StickyActionBar>,
  );
  return screen.getByTestId("bar");
}

describe("StickyActionBar keyboard inset", () => {
  test("lifts the bar by the height the keyboard takes from the visual viewport", () => {
    installVisualViewport(new FakeVisualViewport(window.innerHeight - 300));
    expect(renderBar().style.bottom).toBe("300px");
  });

  test("a visual viewport resize event updates the offset, offsetTop is subtracted", () => {
    const viewport = new FakeVisualViewport(window.innerHeight);
    installVisualViewport(viewport);
    const bar = renderBar();
    expect(bar.style.bottom).toBe("");
    act(() => {
      viewport.height = window.innerHeight - 250;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(bar.style.bottom).toBe("250px");
    act(() => {
      viewport.offsetTop = 50;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(bar.style.bottom).toBe("200px");
    act(() => {
      viewport.height = window.innerHeight;
      viewport.offsetTop = 0;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(bar.style.bottom).toBe("");
  });

  test("without a visual viewport the bar gets no inline style", () => {
    installVisualViewport(undefined);
    expect(renderBar().hasAttribute("style")).toBe(false);
  });
});
