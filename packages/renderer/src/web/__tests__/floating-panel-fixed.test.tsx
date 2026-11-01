import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FloatingPanel, type FloatingPanelProps } from "../widgets/floating-panel.tsx";
import { render, screen } from "./test-utils.tsx";

const STORAGE_KEY = "test:floating-panel-fixed";

function renderFixed(props: Partial<FloatingPanelProps> = {}) {
  return render(
    <FloatingPanel
      title="Assistant"
      testId="panel"
      placement={{ mode: "fixed", rightPx: 32, bottomPx: 24, widthPx: 420, heightPx: 600 }}
      {...props}
    >
      <p>Body</p>
    </FloatingPanel>,
  );
}

describe("FloatingPanel placement fixed", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  test("anchors to the bottom right without grip or resize separators", () => {
    renderFixed();
    const panel = screen.getByTestId("panel");
    expect(panel.style.right).toBe("32px");
    expect(panel.style.bottom).toBe("24px");
    expect(screen.queryByRole("button", { name: /move/i })).toBeNull();
    expect(screen.queryAllByRole("separator")).toHaveLength(0);
    expect(panel.innerHTML).not.toContain("cursor-grab");
  });

  test("ignores the storage key", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ x: 1, y: 1, width: 300, height: 300 }),
    );
    renderFixed({ storageKey: STORAGE_KEY });
    const panel = screen.getByTestId("panel");
    expect(panel.style.width).not.toBe("300px");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({ x: 1, y: 1, width: 300, height: 300 }),
    );
  });

  test("bodyLayout fill leaves the body without padding", () => {
    renderFixed({ bodyLayout: "fill" });
    expect(screen.getByText("Body").parentElement?.className).not.toContain("p-4");
  });

  test("scroll body keeps its padding by default", () => {
    renderFixed();
    expect(screen.getByText("Body").parentElement?.className).toContain("p-4");
  });

  test("ai surface paints the window", () => {
    renderFixed({ surface: "ai" });
    expect(screen.getByTestId("panel").className).toContain("bg-ai-surface");
  });
});
