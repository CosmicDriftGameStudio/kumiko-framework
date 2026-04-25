// @vitest-environment jsdom
//
// Tests pinnen den ThemeToggle-Vertrag: Click ruft toggleMode, Icon-
// Slot defaultet auf Unicode, Custom-Slots werden durchgereicht, das
// title/aria-label-Paar reagiert auf den aktuellen Mode.
//
// Ein Stub-TokensApi reicht — der Hook useTokenController liest nur
// `mode` + `toggleMode`, der Rest (tokens, setMode) wird vom Toggle
// nicht angefasst.

import { TokensProvider } from "@kumiko/renderer";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import { ThemeToggle } from "../layout/theme-toggle";

type StubApi = {
  mode: "light" | "dark";
  toggleMode: () => void;
};

function makeStub(
  initial: "light" | "dark" = "light",
): StubApi & { toggleMode: ReturnType<typeof vi.fn> } {
  const stub = {
    mode: initial,
    toggleMode: vi.fn(),
  } as StubApi & { toggleMode: ReturnType<typeof vi.fn> };
  return stub;
}

function renderWithMode(stub: StubApi, ui: ReactNode) {
  // Cast über unknown — TokensApi hat tokens/setMode die wir hier nicht
  // brauchen, aber der Provider ist generisch typisiert.
  const api = {
    tokens: {} as never,
    mode: stub.mode,
    setMode: () => {},
    toggleMode: stub.toggleMode,
  };
  return render(<TokensProvider value={api}>{ui}</TokensProvider>);
}

describe("ThemeToggle", () => {
  test("rendert Default-Unicode-Icon (☾) im light-Mode", () => {
    const stub = makeStub("light");
    renderWithMode(stub, <ThemeToggle testId="t" />);
    const btn = screen.getByTestId("t");
    expect(btn.textContent).toContain("☾");
    expect(btn.textContent).not.toContain("☀");
  });

  test("rendert Default-Unicode-Icon (☀) im dark-Mode", () => {
    const stub = makeStub("dark");
    renderWithMode(stub, <ThemeToggle testId="t" />);
    const btn = screen.getByTestId("t");
    expect(btn.textContent).toContain("☀");
    expect(btn.textContent).not.toContain("☾");
  });

  test("Custom-Icons werden durchgereicht (Icon-Slots überschreiben Defaults)", () => {
    const stub = makeStub("light");
    renderWithMode(
      stub,
      <ThemeToggle
        testId="t"
        lightIcon={<span data-testid="light-svg">L</span>}
        darkIcon={<span data-testid="dark-svg">D</span>}
      />,
    );
    // light-mode → zeigt darkIcon (klick wechselt zu dark)
    expect(screen.queryByTestId("dark-svg")).not.toBeNull();
    expect(screen.queryByTestId("light-svg")).toBeNull();
  });

  test("Click ruft toggleMode genau einmal", () => {
    const stub = makeStub("light");
    renderWithMode(stub, <ThemeToggle testId="t" />);
    fireEvent.click(screen.getByTestId("t"));
    expect(stub.toggleMode).toHaveBeenCalledTimes(1);
  });

  test("aria-label und title spiegeln den Mode-Übergang", () => {
    const lightStub = makeStub("light");
    const { unmount } = renderWithMode(
      lightStub,
      <ThemeToggle testId="t" titleInLight="zu dark" titleInDark="zu light" />,
    );
    // Im light-Mode kündigt der Toggle an "wechselt zu dark"
    expect(screen.getByTestId("t").getAttribute("aria-label")).toBe("zu dark");
    expect(screen.getByTestId("t").getAttribute("title")).toBe("zu dark");
    unmount();

    const darkStub = makeStub("dark");
    renderWithMode(
      darkStub,
      <ThemeToggle testId="t" titleInLight="zu dark" titleInDark="zu light" />,
    );
    expect(screen.getByTestId("t").getAttribute("aria-label")).toBe("zu light");
  });
});
