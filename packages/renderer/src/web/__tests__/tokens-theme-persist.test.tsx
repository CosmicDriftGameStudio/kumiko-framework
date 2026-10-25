// Theme persistence: the toggle set only the .dark class — without localStorage
// persistence and restore, the choice was lost after every reload, making it
// appear to users as if "dark/light doesn't work". FOUC protection (an inline
// script in the host HTML) belongs to the app; this pins the JavaScript side.

import { beforeEach, describe, expect, test } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  __resetStoredModeAppliedForTests,
  applyStoredThemeMode,
  THEME_STORAGE_KEY,
  useBrowserTokensApi,
} from "../tokens.ts";

function Probe(): ReactNode {
  const api = useBrowserTokensApi();
  return (
    <div>
      <span data-testid="mode">{api.mode}</span>
      <button type="button" data-testid="toggle" onClick={() => api.toggleMode()}>
        toggle
      </button>
      <button type="button" data-testid="set-light" onClick={() => api.setMode("light")}>
        light
      </button>
    </div>
  );
}

describe("useBrowserTokensApi — Theme-Persistenz", () => {
  beforeEach(() => {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    document.documentElement.classList.remove("dark");
  });

  test("toggleMode persistiert die Wahl in localStorage", () => {
    render(<Probe />);
    expect(screen.getByTestId("mode").textContent).toBe("light");

    act(() => {
      screen.getByTestId("toggle").click();
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    act(() => {
      screen.getByTestId("toggle").click();
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  test("setMode persistiert ebenfalls", () => {
    render(<Probe />);
    act(() => {
      screen.getByTestId("set-light").click();
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  test("Mount-Restore: the first hook mount applies the stored choice to the DOM", () => {
    // Test the actual integration path: do not isolate applyStoredThemeMode;
    // seed localStorage BEFORE mounting, so the mount itself must set the
    // .dark class.
    __resetStoredModeAppliedForTests();
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    document.documentElement.classList.remove("dark");

    render(<Probe />);

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByTestId("mode").textContent).toBe("dark");
  });

  test("applyStoredThemeMode restored die gespeicherte Wahl (Reload-Simulation)", () => {
    // "Reload": the class is gone (fresh HTML), but localStorage still contains dark.
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    document.documentElement.classList.remove("dark");

    applyStoredThemeMode();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  test("applyStoredThemeMode without a stored choice leaves the HTML default unchanged", () => {
    document.documentElement.classList.add("dark");
    applyStoredThemeMode();
    // No stored value means the HTML default remains unchanged.
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  test("applyStoredThemeMode ignoriert kaputte Werte", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "neon");
    applyStoredThemeMode();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
