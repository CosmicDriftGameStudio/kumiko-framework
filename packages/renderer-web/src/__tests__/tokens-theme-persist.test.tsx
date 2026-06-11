// Theme-Persistenz (Bug-Bash 2026-06-07, Bug 13): Der Toggle setzte
// nur die .dark-Class — ohne localStorage-Persist + Restore war die
// Wahl nach jedem Reload weg, was sich für User als "dark/light geht
// nicht" anfühlte. Der FOUC-Schutz (Inline-Script in der Host-HTML)
// ist App-Sache; hier wird die JS-Seite gepinnt.

import { beforeEach, describe, expect, test } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  __resetStoredModeAppliedForTests,
  applyStoredThemeMode,
  THEME_STORAGE_KEY,
  useBrowserTokensApi,
} from "../tokens";

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

  test("Mount-Restore: erster Hook-Mount übernimmt die gespeicherte Wahl ins DOM", () => {
    // Der eigentliche Headline-Pfad (286/1): nicht applyStoredThemeMode
    // isoliert, sondern die Glue im Hook — localStorage VOR dem Mount
    // geseedet, der Mount selbst muss die .dark-Class setzen.
    __resetStoredModeAppliedForTests();
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    document.documentElement.classList.remove("dark");

    render(<Probe />);

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByTestId("mode").textContent).toBe("dark");
  });

  test("applyStoredThemeMode restored die gespeicherte Wahl (Reload-Simulation)", () => {
    // "Reload": Class weg (frisches HTML), aber localStorage hat dark.
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    document.documentElement.classList.remove("dark");

    applyStoredThemeMode();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  test("applyStoredThemeMode ohne gespeicherte Wahl lässt den HTML-Default stehen", () => {
    document.documentElement.classList.add("dark");
    applyStoredThemeMode();
    // Kein gespeicherter Wert → nichts anfassen.
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  test("applyStoredThemeMode ignoriert kaputte Werte", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "neon");
    applyStoredThemeMode();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
