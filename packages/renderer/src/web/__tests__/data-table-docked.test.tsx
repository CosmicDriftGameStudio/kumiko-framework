// hideWhenDocked reacts to the table's container width; hideOnNarrow only to the viewport.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { defaultPrimitives } from "../primitives/index.tsx";
import { act, atViewportWidth, render, screen, waitFor } from "./test-utils.tsx";

const { DataTable } = defaultPrimitives;

const COLUMNS = [
  { field: "name", label: "Name", type: "string", sortable: false },
  { field: "gives", label: "Gives away", type: "string", sortable: false, hideWhenDocked: true },
  { field: "intent", label: "Intent", type: "string", sortable: false, hideOnNarrow: true },
] as const;

const ROWS = [{ id: "r1", values: { name: "Alpha", gives: "yes", intent: "sell" } }];

class FakeResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

describe("DataTable in a docked (narrow) container on a wide viewport", () => {
  const original = globalThis.ResizeObserver;
  afterEach(() => {
    globalThis.ResizeObserver = original;
  });

  test("hideWhenDocked leaves the table, hideOnNarrow stays", () => {
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    const measure = spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 500,
    } as DOMRect);
    try {
      atViewportWidth(1280, () => {
        render(<DataTable columns={COLUMNS} rows={ROWS} />);
      });
      expect(screen.queryByText("Gives away")).toBeNull();
      expect(screen.queryByText("Intent")).not.toBeNull();
    } finally {
      measure.mockRestore();
    }
  });

  test("a docked assistant panel hides hideWhenDocked columns although the container is wide", () => {
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    const measure = spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1200,
    } as DOMRect);
    // happy-dom does not inherit custom properties; a browser hands the shell's variable down.
    const computed = spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: () => "440px",
    } as unknown as CSSStyleDeclaration);
    try {
      atViewportWidth(1920, () => {
        render(<DataTable columns={COLUMNS} rows={ROWS} />);
      });
      expect(screen.queryByText("Gives away")).toBeNull();
      expect(screen.queryByText("Intent")).not.toBeNull();
    } finally {
      computed.mockRestore();
      measure.mockRestore();
    }
  });

  test("the panel docking after mount hides the column although the table width never changes", async () => {
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    const measure = spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1200,
    } as DOMRect);
    let panelWidth = "0px";
    const computed = spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: () => panelWidth,
    } as unknown as CSSStyleDeclaration);
    try {
      atViewportWidth(1920, () => {
        render(<DataTable columns={COLUMNS} rows={ROWS} />);
      });
      expect(screen.queryByText("Gives away")).not.toBeNull();
      panelWidth = "440px";
      await act(async () => {
        document.documentElement.style.setProperty("--agent-panel-width", panelWidth);
      });
      await waitFor(() => expect(screen.queryByText("Gives away")).toBeNull());
    } finally {
      await act(async () => {
        document.documentElement.style.removeProperty("--agent-panel-width");
      });
      computed.mockRestore();
      measure.mockRestore();
    }
  });

  test("a wide container shows both columns", () => {
    atViewportWidth(1280, () => {
      render(<DataTable columns={COLUMNS} rows={ROWS} />);
    });
    expect(screen.queryByText("Gives away")).not.toBeNull();
    expect(screen.queryByText("Intent")).not.toBeNull();
  });
});
