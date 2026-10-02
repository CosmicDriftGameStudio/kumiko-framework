import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createPortal } from "react-dom";
import { FloatingPanel } from "../widgets/floating-panel.js";
import { act, fireEvent, render, screen } from "./test-utils.js";

const STORAGE_KEY = "test:floating-panel";
const WIDE = { width: 1280, height: 800 };

type HappyDomWindow = {
  readonly happyDOM: {
    setViewport: (viewport: { width: number; height: number }) => void;
  };
};

function setViewport(viewport: { width: number; height: number }): void {
  act(() => (window as unknown as HappyDomWindow).happyDOM.setViewport(viewport));
}

function panel(): HTMLElement {
  return screen.getByRole("dialog");
}

function geometryOf(element: HTMLElement): { x: number; y: number; width: number; height: number } {
  return {
    x: Number.parseFloat(element.style.left),
    y: Number.parseFloat(element.style.top),
    width: Number.parseFloat(element.style.width),
    height: Number.parseFloat(element.style.height),
  };
}

function renderPanel(props: Partial<Parameters<typeof FloatingPanel>[0]> = {}) {
  return render(
    <FloatingPanel
      title="Assistant"
      headerActions={<button type="button">Close</button>}
      testId="panel"
      {...props}
    >
      <p>Body</p>
    </FloatingPanel>,
  );
}

function cornerHandles(): HTMLElement[] {
  return Array.from(panel().querySelectorAll<HTMLElement>('div[aria-hidden="true"]'));
}

describe("FloatingPanel", () => {
  let originalViewport: { width: number; height: number };

  beforeEach(() => {
    originalViewport = { width: window.innerWidth, height: window.innerHeight };
    window.localStorage.clear();
    setViewport(WIDE);
  });

  afterEach(() => {
    window.localStorage.clear();
    setViewport(originalViewport);
  });

  test("renders a non-modal dialog labelled by its title, portalled to body", () => {
    renderPanel();
    const dialog = panel();
    expect(dialog.getAttribute("aria-modal")).toBe("false");
    expect(dialog.parentElement).toBe(document.body);
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).not.toBeNull();
    expect(document.getElementById(labelledBy ?? "")?.textContent).toBe("Assistant");
    expect(screen.getByText("Body")).toBeTruthy();
  });

  test("default geometry is 400x560 in the bottom-right corner with a 24px margin", () => {
    renderPanel();
    expect(geometryOf(panel())).toEqual({ x: 856, y: 216, width: 400, height: 560 });
  });

  test("defaultGeometry overrides the defaults", () => {
    renderPanel({ defaultGeometry: { x: 10, y: 20, width: 300, height: 300 } });
    expect(geometryOf(panel())).toEqual({ x: 10, y: 20, width: 300, height: 300 });
  });

  describe("keyboard", () => {
    test("the grip button moves the panel by 16px, 40px with Shift", () => {
      renderPanel();
      const grip = screen.getByRole("button", { name: "Move panel" });
      fireEvent.keyDown(grip, { key: "ArrowLeft" });
      expect(geometryOf(panel())).toMatchObject({ x: 840, y: 216 });
      fireEvent.keyDown(grip, { key: "ArrowUp", shiftKey: true });
      expect(geometryOf(panel())).toMatchObject({ x: 840, y: 176 });
    });

    test("moving never pushes the panel out of the viewport", () => {
      renderPanel({ defaultGeometry: { x: 0, y: 0 } });
      const grip = screen.getByRole("button", { name: "Move panel" });
      fireEvent.keyDown(grip, { key: "ArrowLeft" });
      fireEvent.keyDown(grip, { key: "ArrowUp" });
      expect(geometryOf(panel())).toMatchObject({ x: 0, y: 0 });
    });

    test("a resize separator stops at the minimum size", () => {
      renderPanel({ minWidthPx: 380 });
      const right = screen.getByRole("separator", { name: "Resize panel from the right edge" });
      expect(right.getAttribute("aria-valuenow")).toBe("400");
      fireEvent.keyDown(right, { key: "ArrowLeft" });
      fireEvent.keyDown(right, { key: "ArrowLeft" });
      fireEvent.keyDown(right, { key: "ArrowLeft" });
      expect(geometryOf(panel()).width).toBe(380);
      expect(right.getAttribute("aria-valuenow")).toBe("380");
      expect(right.getAttribute("aria-valuemin")).toBe("380");
    });

    test("resizing from the left edge keeps the right edge in place", () => {
      renderPanel();
      const left = screen.getByRole("separator", { name: "Resize panel from the left edge" });
      expect(left.getAttribute("aria-orientation")).toBe("vertical");
      fireEvent.keyDown(left, { key: "ArrowLeft" });
      expect(geometryOf(panel())).toMatchObject({ x: 840, width: 416 });
    });

    test("the top and bottom separators react to vertical arrows only", () => {
      renderPanel();
      const top = screen.getByRole("separator", { name: "Resize panel from the top edge" });
      expect(top.getAttribute("aria-orientation")).toBe("horizontal");
      fireEvent.keyDown(top, { key: "ArrowLeft" });
      expect(geometryOf(panel())).toMatchObject({ y: 216, height: 560 });
      fireEvent.keyDown(top, { key: "ArrowUp" });
      expect(geometryOf(panel())).toMatchObject({ y: 200, height: 576 });
      const bottom = screen.getByRole("separator", { name: "Resize panel from the bottom edge" });
      fireEvent.keyDown(bottom, { key: "ArrowUp" });
      expect(geometryOf(panel())).toMatchObject({ y: 200, height: 560 });
    });
  });

  describe("pointer", () => {
    function header(): HTMLElement {
      const element = screen.getByText("Assistant").parentElement;
      if (element === null) throw new Error("header not found");
      return element;
    }

    test("dragging the header moves the panel by the pointer delta, persisted on release only", () => {
      renderPanel({ storageKey: STORAGE_KEY });
      fireEvent.pointerDown(header(), { pointerId: 1, clientX: 500, clientY: 300 });
      fireEvent.pointerMove(header(), { pointerId: 1, clientX: 460, clientY: 270 });
      expect(geometryOf(panel())).toMatchObject({ x: 816, y: 186 });
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
      fireEvent.pointerUp(header(), { pointerId: 1, clientX: 460, clientY: 270 });
      expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual({
        x: 816,
        y: 186,
        width: 400,
        height: 560,
      });
    });

    test("pointer-down on a header button does not start a drag", () => {
      renderPanel();
      const close = screen.getByRole("button", { name: "Close" });
      fireEvent.pointerDown(close, { pointerId: 1, clientX: 500, clientY: 300 });
      fireEvent.pointerMove(header(), { pointerId: 1, clientX: 400, clientY: 200 });
      expect(geometryOf(panel())).toMatchObject({ x: 856, y: 216 });
    });

    test("pointer-down on a portalled header menu item neither starts a drag nor swallows the click", () => {
      const onSelect = mock(() => {});
      renderPanel({
        headerActions: createPortal(
          <div role="menuitem" tabIndex={-1} onClick={onSelect} onKeyDown={onSelect}>
            Clear
          </div>,
          document.body,
        ),
      });
      const item = screen.getByRole("menuitem", { name: "Clear" });
      // fireEvent returns false when a handler called preventDefault(), which would swallow the click in a browser.
      const notPrevented = fireEvent.pointerDown(item, {
        pointerId: 1,
        clientX: 500,
        clientY: 300,
      });
      expect(notPrevented).toBe(true);
      fireEvent.pointerMove(header(), { pointerId: 1, clientX: 400, clientY: 200 });
      fireEvent.click(item);
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(geometryOf(panel())).toMatchObject({ x: 856, y: 216 });
    });

    test("dragging the Move panel grip button moves the panel", () => {
      renderPanel();
      const grip = screen.getByRole("button", { name: "Move panel" });
      fireEvent.pointerDown(grip, { pointerId: 1, clientX: 500, clientY: 300 });
      fireEvent.pointerMove(grip, { pointerId: 1, clientX: 460, clientY: 270 });
      fireEvent.pointerUp(grip, { pointerId: 1, clientX: 460, clientY: 270 });
      expect(geometryOf(panel())).toMatchObject({ x: 816, y: 186 });
    });

    test("pointer-down on another header button still does not start a drag", () => {
      renderPanel();
      const close = screen.getByRole("button", { name: "Close" });
      fireEvent.pointerDown(close, { pointerId: 1, clientX: 500, clientY: 300 });
      fireEvent.pointerMove(close, { pointerId: 1, clientX: 460, clientY: 270 });
      expect(geometryOf(panel())).toMatchObject({ x: 856, y: 216 });
    });

    test("dragging the bottom-right corner grows the panel, the top-left corner moves the origin", () => {
      renderPanel({ defaultGeometry: { x: 200, y: 100, width: 400, height: 400 } });
      const [topLeft, , , bottomRight] = cornerHandles();
      if (!topLeft || !bottomRight) throw new Error("corner handles missing");
      fireEvent.pointerDown(bottomRight, { pointerId: 1, clientX: 600, clientY: 500 });
      fireEvent.pointerMove(bottomRight, { pointerId: 1, clientX: 650, clientY: 540 });
      fireEvent.pointerUp(bottomRight, { pointerId: 1, clientX: 650, clientY: 540 });
      expect(geometryOf(panel())).toEqual({ x: 200, y: 100, width: 450, height: 440 });

      fireEvent.pointerDown(topLeft, { pointerId: 2, clientX: 200, clientY: 100 });
      fireEvent.pointerMove(topLeft, { pointerId: 2, clientX: 230, clientY: 120 });
      fireEvent.pointerUp(topLeft, { pointerId: 2, clientX: 230, clientY: 120 });
      expect(geometryOf(panel())).toEqual({ x: 230, y: 120, width: 420, height: 420 });
    });
  });

  describe("storage", () => {
    test("a stored geometry is restored", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ x: 100, y: 50, width: 500, height: 400 }),
      );
      renderPanel({ storageKey: STORAGE_KEY });
      expect(geometryOf(panel())).toEqual({ x: 100, y: 50, width: 500, height: 400 });
    });

    test("a stored geometry is clamped into the current viewport", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ x: 5000, y: 5000, width: 9000, height: 9000 }),
      );
      renderPanel({ storageKey: STORAGE_KEY });
      const { x, y, width, height } = geometryOf(panel());
      expect(width).toBe(WIDE.width - 48);
      expect(height).toBe(WIDE.height - 48);
      expect(x + width).toBeLessThanOrEqual(WIDE.width);
      expect(y + height).toBeLessThanOrEqual(WIDE.height);
    });

    test.each([
      ["invalid JSON", "{not json"],
      ["a non-object", "42"],
      ["null", "null"],
      ["a missing field", JSON.stringify({ x: 1, y: 2, width: 300 })],
      ["a non-number field", JSON.stringify({ x: "1", y: 2, width: 300, height: 300 })],
    ])("%s in storage falls back to the default geometry", (_label, raw) => {
      window.localStorage.setItem(STORAGE_KEY, raw);
      renderPanel({ storageKey: STORAGE_KEY });
      expect(geometryOf(panel())).toEqual({ x: 856, y: 216, width: 400, height: 560 });
    });

    test("keyboard steps are persisted", () => {
      renderPanel({ storageKey: STORAGE_KEY });
      fireEvent.keyDown(screen.getByRole("button", { name: "Move panel" }), { key: "ArrowLeft" });
      expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")).toMatchObject({
        x: 840,
      });
    });

    test("without a storageKey nothing is written", () => {
      renderPanel();
      fireEvent.keyDown(screen.getByRole("button", { name: "Move panel" }), { key: "ArrowLeft" });
      expect(window.localStorage.length).toBe(0);
    });

    describe("storage that throws", () => {
      let originalDescriptor: PropertyDescriptor | undefined;

      beforeEach(() => {
        originalDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
        const throwingStorage = {
          getItem: () => {
            throw new Error("storage denied");
          },
          setItem: () => {
            throw new Error("storage denied");
          },
        };
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          value: throwingStorage,
        });
      });

      afterEach(() => {
        if (originalDescriptor) Object.defineProperty(window, "localStorage", originalDescriptor);
      });

      test("still renders with the default geometry and keeps working", () => {
        renderPanel({ storageKey: STORAGE_KEY });
        expect(geometryOf(panel())).toEqual({ x: 856, y: 216, width: 400, height: 560 });
        fireEvent.keyDown(screen.getByRole("button", { name: "Move panel" }), {
          key: "ArrowLeft",
        });
        expect(geometryOf(panel()).x).toBe(840);
      });
    });
  });

  describe("narrow viewport", () => {
    test("renders a full-screen sheet without move or resize affordances", () => {
      setViewport({ width: 500, height: 800 });
      renderPanel();
      expect(panel().className).toContain("inset-0");
      expect(panel().style.left).toBe("");
      expect(screen.queryByRole("separator")).toBeNull();
      expect(screen.queryByRole("button", { name: "Move panel" })).toBeNull();
      expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
      expect(screen.getByText("Body")).toBeTruthy();
    });

    test("going back to a wide viewport re-fits a geometry that no longer fits", () => {
      setViewport({ width: 500, height: 800 });
      renderPanel({ defaultGeometry: { x: 100, y: 50, width: 400, height: 500 } });
      // happy-dom's MediaQueryList assumes an initial "no match" state and only dispatches "change"
      // on a flip, so a first resize while still narrow primes it.
      setViewport({ width: 600, height: 800 });
      setViewport({ width: 900, height: 300 });
      expect(geometryOf(panel()).height).toBe(252);
    });

    test("leaves the stored geometry untouched", () => {
      const stored = JSON.stringify({ x: 100, y: 50, width: 500, height: 400 });
      window.localStorage.setItem(STORAGE_KEY, stored);
      setViewport({ width: 500, height: 800 });
      renderPanel({ storageKey: STORAGE_KEY });
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe(stored);
    });
  });

  test("a window resize re-clamps the panel into the smaller viewport", () => {
    renderPanel();
    expect(geometryOf(panel())).toEqual({ x: 856, y: 216, width: 400, height: 560 });
    setViewport({ width: 900, height: 500 });
    const { x, y, width, height } = geometryOf(panel());
    expect(width).toBe(400);
    expect(height).toBe(452);
    expect(x).toBe(500);
    expect(y).toBe(48);
  });
});
