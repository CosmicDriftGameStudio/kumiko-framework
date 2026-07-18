import { createStore } from "@cosmicdrift/kumiko-headless";
import {
  cssVarTokens,
  type ThemeMode,
  type Tokens,
  type TokensApi,
} from "@cosmicdrift/kumiko-renderer";
import { useState, useSyncExternalStore } from "react";

// Web-spezifische TokensApi-Impl. Theme-Toggle via `.dark`-Class auf
// <html>. Die echten Farben leben in styles.css; hier ist nur die
// JS-Seite die den class-switch triggert und React-Consumer mit
// useSyncExternalStore darüber informiert.
//
// Source-of-truth ist der DOM (`<html class="dark">`); der Store ist
// reiner Notification-Bus (Tick-Counter), den setMode/toggleMode bei
// jedem Class-Wechsel hochzählen. So bleibt die DOM-Klasse die einzige
// Wahrheit — readCurrentMode liest sie frisch bei jedem getSnapshot.
//
// Persistenz: die Wahl landet in localStorage (THEME_STORAGE_KEY) und
// wird beim ersten Hook-Mount restored — ohne das war der Toggle nach
// jedem Reload weg ("dark/light geht nicht", Prod-Bug 2026-06-07).
// Gegen FOUC gehört zusätzlich ein synchrones Inline-Script in die
// Host-HTML, VOR dem Stylesheet-Link:
//
//   <script>try{if(localStorage.getItem("kumiko:theme")==="dark")
//     document.documentElement.classList.add("dark")}catch(e){}</script>

const themeTick = createStore(0);

export const THEME_STORAGE_KEY = "kumiko:theme";

function readCurrentMode(): ThemeMode {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

// @wrapper-known semantic-alias
function notifyThemeChange(): void {
  themeTick.setState((t) => t + 1);
}

// @wrapper-known semantic-alias
function persistMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // skip: localStorage kann werfen (Private-Mode/Quota) — Theme bleibt
    // dann sessionbasiert, der Class-Toggle hat trotzdem funktioniert.
  }
}

/** Liest die persistierte Theme-Wahl und setzt die `.dark`-Class. Wird
 *  beim ersten useBrowserTokensApi-Mount aufgerufen; das Inline-Script
 *  in der Host-HTML (siehe Header-Kommentar) macht dasselbe synchron
 *  vor dem ersten Paint. */
export function applyStoredThemeMode(): void {
  // skip: no document (SSR/non-DOM context), nothing to apply
  if (typeof document === "undefined") return;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // skip: localStorage kann werfen (Private-Mode) — ohne gespeicherte
    // Wahl bleibt der Server-/HTML-Default stehen.
  }
  // skip: no valid persisted mode stored, keep server/HTML default
  if (stored !== "dark" && stored !== "light") return;
  document.documentElement.classList.toggle("dark", stored === "dark");
  notifyThemeChange();
}

let storedModeApplied = false;

/** Nur für Tests: der once-per-page-load-Guard ist ein Module-Singleton —
 *  ohne Reset wäre der Mount-Restore-Pfad nach der ersten Render im
 *  Testfile strukturell unerreichbar. */
export function __resetStoredModeAppliedForTests(): void {
  storedModeApplied = false;
}

/** Hook der eine TokensApi für den Browser baut. Wird von
 *  createKumikoApp genutzt; App-Code der einen eigenen Token-State
 *  braucht (z.B. User-Präferenz aus localStorage) kann selber
 *  `<TokensProvider value={...}>` mounten. */
export function useBrowserTokensApi(): TokensApi {
  // Einmal pro Page-Load: gespeicherte Wahl anwenden. Lazy statt
  // Modul-Side-Effect, damit Import ohne DOM (SSR/Tests) safe bleibt.
  // Als useState-Lazy-Initializer statt nackt im Render-Body: der
  // DOM-Side-Effect lief sonst potenziell in einem verworfenen
  // Concurrent-Render (React darf Render-Bodies wiederholen/abbrechen).
  useState(() => {
    if (!storedModeApplied && typeof document !== "undefined") {
      storedModeApplied = true;
      applyStoredThemeMode();
    }
    return null;
  });
  const mode = useSyncExternalStore(themeTick.subscribe, readCurrentMode, () => "dark" as const);
  return {
    tokens: cssVarTokens,
    mode,
    setMode: (next) => {
      // skip: no document (SSR/non-DOM context), nothing to toggle
      if (typeof document === "undefined") return;
      document.documentElement.classList.toggle("dark", next === "dark");
      persistMode(next);
      notifyThemeChange();
    },
    toggleMode: () => {
      // skip: no document (SSR/non-DOM context), nothing to toggle
      if (typeof document === "undefined") return;
      const nowDark = document.documentElement.classList.toggle("dark");
      persistMode(nowDark ? "dark" : "light");
      notifyThemeChange();
    },
  };
}

/** Default-Tokens — identisch zu `cssVarTokens` (var-string-refs).
 *  Light- und Dark-Werte switchen via `.dark`-class auf <html>. */
export const defaultTokens: Tokens = cssVarTokens;
export const lightTokens: Tokens = cssVarTokens;

/** Historisch: schrieb Tokens auf :root als CSS-vars. Jetzt no-op —
 *  die CSS-vars leben in styles.css, nicht in JS. Bleibt als Export
 *  damit alter App-Code nicht bricht. */
export function applyTokensToCssVars(_tokens: Tokens): void {
  // Absichtlich leer — siehe Kommentar oben.
}
