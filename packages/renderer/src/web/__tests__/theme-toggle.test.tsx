// These tests pin the ThemeToggle contract: clicking calls toggleMode, the icon
// slot defaults to Unicode, custom slots are forwarded, and the title/aria-label
// pair reflects the current mode.
//
// A stub TokensApi is sufficient because useTokenController only reads `mode` +
// `toggleMode`; the Toggle does not access the rest (`tokens`, `setMode`).

import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TokensProvider } from "../../index.ts";
import { ThemeToggle } from "../layout/theme-toggle.tsx";

type StubApi = {
  mode: "light" | "dark";
  toggleMode: () => void;
};

function makeStub(
  initial: "light" | "dark" = "light",
): StubApi & { toggleMode: ReturnType<typeof mock> } {
  const stub = {
    mode: initial,
    toggleMode: mock(),
  } as StubApi & { toggleMode: ReturnType<typeof mock> };
  return stub;
}

function renderWithMode(stub: StubApi, ui: ReactNode) {
  // Cast through unknown because TokensApi requires tokens/setMode, which are not
  // needed here, but the provider is generically typed.
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

  test("Custom icons are passed through (icon slots override defaults)", () => {
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

  test("aria-label and title mirror the mode transition", () => {
    const lightStub = makeStub("light");
    const { unmount } = renderWithMode(
      lightStub,
      <ThemeToggle testId="t" titleInLight="zu dark" titleInDark="zu light" />,
    );
    // In light mode, the Toggle announces "switches to dark"
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
