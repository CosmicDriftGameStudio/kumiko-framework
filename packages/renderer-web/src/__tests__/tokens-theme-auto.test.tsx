// Theme preference "auto": follows prefers-color-scheme live, an explicit
// choice is stored and wins, the app default applies without a stored choice.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TokensProvider } from "@cosmicdrift/kumiko-renderer";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { DEFAULT_COLOR_SCHEME_VARIABLE } from "../default-color-scheme.js";
import { ThemeToggle } from "../layout/theme-toggle.js";
import {
  __resetStoredModeAppliedForTests,
  THEME_STORAGE_KEY,
  useBrowserTokensApi,
} from "../tokens.js";

type ChangeListener = () => void;

function installMatchMedia(initialDark: boolean): { setSystemDark: (dark: boolean) => void } {
  let systemDark = initialDark;
  const listeners = new Set<ChangeListener>();
  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() {
      return systemDark;
    },
    addEventListener: (_type: string, listener: ChangeListener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: ChangeListener) => listeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
  return {
    setSystemDark: (dark) => {
      systemDark = dark;
      for (const listener of listeners) listener();
    },
  };
}

function Probe(): ReactNode {
  const api = useBrowserTokensApi();
  return (
    <TokensProvider value={api}>
      <span data-testid="mode">{api.mode}</span>
      <span data-testid="preference">{api.preference}</span>
      <button type="button" data-testid="set-auto" onClick={() => api.setPreference?.("auto")}>
        auto
      </button>
      <button type="button" data-testid="set-light" onClick={() => api.setMode("light")}>
        light
      </button>
      <ThemeToggle testId="toggle" />
    </TokensProvider>
  );
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  __resetStoredModeAppliedForTests();
  window.localStorage.removeItem(THEME_STORAGE_KEY);
  document.documentElement.classList.remove("dark");
  document.documentElement.style.removeProperty(DEFAULT_COLOR_SCHEME_VARIABLE);
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  document.documentElement.style.removeProperty(DEFAULT_COLOR_SCHEME_VARIABLE);
});

describe("theme preference auto", () => {
  test("starts with the OS scheme and follows live changes", () => {
    const media = installMatchMedia(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "auto");

    render(<Probe />);
    expect(screen.getByTestId("preference").textContent).toBe("auto");
    expect(screen.getByTestId("mode").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    act(() => media.setSystemDark(false));
    expect(screen.getByTestId("mode").textContent).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => media.setSystemDark(true));
    expect(screen.getByTestId("mode").textContent).toBe("dark");
  });

  test("an explicit choice is stored and ignores OS changes", () => {
    const media = installMatchMedia(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "auto");
    render(<Probe />);

    act(() => screen.getByTestId("set-light").click());
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(screen.getByTestId("preference").textContent).toBe("light");

    act(() => media.setSystemDark(false));
    act(() => media.setSystemDark(true));
    expect(screen.getByTestId("mode").textContent).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  test("choosing auto stores it and applies the current OS scheme", () => {
    installMatchMedia(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<Probe />);
    expect(screen.getByTestId("mode").textContent).toBe("light");

    act(() => screen.getByTestId("set-auto").click());
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("auto");
    expect(screen.getByTestId("mode").textContent).toBe("dark");
  });

  test("the app default applies without a stored choice, a stored choice beats it", () => {
    installMatchMedia(true);
    document.documentElement.style.setProperty(DEFAULT_COLOR_SCHEME_VARIABLE, "auto");
    const { unmount } = render(<Probe />);
    expect(screen.getByTestId("preference").textContent).toBe("auto");
    expect(screen.getByTestId("mode").textContent).toBe("dark");
    unmount();

    __resetStoredModeAppliedForTests();
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<Probe />);
    expect(screen.getByTestId("preference").textContent).toBe("light");
    expect(screen.getByTestId("mode").textContent).toBe("light");
  });

  test("without any default or stored choice the HTML state stays as it was", () => {
    installMatchMedia(true);
    render(<Probe />);
    expect(screen.getByTestId("preference").textContent).toBe("light");
    expect(screen.getByTestId("mode").textContent).toBe("light");
  });

  test("the toggle steps light, dark, auto and back", () => {
    installMatchMedia(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<Probe />);
    const toggle = screen.getByTestId("toggle");
    expect(toggle.getAttribute("aria-label")).toBe("Dark theme");

    fireEvent.click(toggle);
    expect(screen.getByTestId("preference").textContent).toBe("dark");
    expect(toggle.getAttribute("aria-label")).toBe("Automatic theme");

    fireEvent.click(toggle);
    expect(screen.getByTestId("preference").textContent).toBe("auto");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("auto");
    expect(toggle.getAttribute("aria-label")).toBe("Light theme");

    fireEvent.click(toggle);
    expect(screen.getByTestId("preference").textContent).toBe("light");
  });
});
