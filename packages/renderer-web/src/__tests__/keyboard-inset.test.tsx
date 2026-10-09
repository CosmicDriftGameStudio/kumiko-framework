// iOS Safari ignores interactive-widget=resizes-content, so fixed bottom bars follow
// window.visualViewport instead (fw#1959).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { defaultPrimitives } from "../primitives/index.js";
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

describe("pinned narrow FormFooter keyboard inset", () => {
  const { Form, Button } = defaultPrimitives;
  let wideInnerWidth = 0;
  beforeEach(() => {
    wideInnerWidth = window.innerWidth;
    setInnerWidth(390);
  });
  afterEach(() => {
    setInnerWidth(wideInnerWidth);
  });

  function setInnerWidth(width: number): void {
    (
      window as unknown as { happyDOM: { setInnerWidth: (n: number) => void } }
    ).happyDOM.setInnerWidth(width);
  }

  function renderPinned(): HTMLElement {
    render(
      <Form onSubmit={() => {}} fillHeight stickyActions actions={<Button>Save</Button>} testId="f">
        <div>body</div>
      </Form>,
    );
    return screen.getByTestId("f-actions");
  }

  test("lifts the in-flow footer by the keyboard height", () => {
    installVisualViewport(new FakeVisualViewport(window.innerHeight - 300));
    const footer = renderPinned();
    expect(footer.style.transform).toBe("translateY(-300px)");
    expect(footer.style.position).toBe("relative");
  });

  test("without keyboard inset the footer gets no inline style", () => {
    installVisualViewport(new FakeVisualViewport(window.innerHeight));
    expect(renderPinned().hasAttribute("style")).toBe(false);
  });
});
