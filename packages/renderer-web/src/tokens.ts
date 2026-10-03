import { createStore } from "@cosmicdrift/kumiko-headless";
import {
  cssVarTokens,
  type ThemeMode,
  type ThemePreference,
  type Tokens,
  type TokensApi,
} from "@cosmicdrift/kumiko-renderer";
import { useEffect, useState, useSyncExternalStore } from "react";
import { DEFAULT_COLOR_SCHEME_VARIABLE } from "./default-color-scheme.js";

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
// Persistence: the choice is stored in localStorage (THEME_STORAGE_KEY) and
// restored on the first hook mount; without it the toggle was lost on every
// reload (prod bug 2026-06-07).
// Preference: "auto" follows prefers-color-scheme live (matchMedia listener),
// "light"/"dark" are explicit choices and win. Without a stored choice,
// AppTheme.defaultColorScheme (CSS variable) applies, otherwise the HTML state.
//
// Against FOUC the host HTML also needs a synchronous inline script BEFORE
// the stylesheet link (nonce/hash under a strict CSP):
//
//   <script>try{var s=localStorage.getItem("kumiko:theme");
//     if(s==="dark"||(s==="auto"&&matchMedia("(prefers-color-scheme: dark)").matches))
//     document.documentElement.classList.add("dark")}catch(e){}</script>

const themeTick = createStore(0);

export const THEME_STORAGE_KEY = "kumiko:theme";

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "auto" || value === "light" || value === "dark";
}

function readCurrentMode(): ThemeMode {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_SCHEME_QUERY).matches;
}

function resolveMode(preference: ThemePreference): ThemeMode {
  if (preference === "auto") return systemPrefersDark() ? "dark" : "light";
  return preference;
}

function readDefaultPreference(): ThemePreference {
  const declared = getComputedStyle(document.documentElement)
    .getPropertyValue(DEFAULT_COLOR_SCHEME_VARIABLE)
    .trim();
  return isThemePreference(declared) ? declared : readCurrentMode();
}

function readStoredPreference(): ThemePreference | undefined {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : undefined;
  } catch {
    // skip: localStorage can throw (private mode); without a stored choice
    // the default stays.
    return undefined;
  }
}

// Module singleton like storedModeApplied: null until the first read, so the
// import stays safe without a DOM (SSR/tests).
let currentPreference: ThemePreference | null = null;

function readCurrentPreference(): ThemePreference {
  if (currentPreference === null) {
    if (typeof document === "undefined") return "dark";
    currentPreference = readStoredPreference() ?? readDefaultPreference();
  }
  return currentPreference;
}

// @wrapper-known semantic-alias
function notifyThemeChange(): void {
  themeTick.setState((t) => t + 1);
}

// @wrapper-known semantic-alias
function persistPreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // skip: localStorage kann werfen (Private-Mode/Quota) — Theme bleibt
    // dann sessionbasiert, der Class-Toggle hat trotzdem funktioniert.
  }
}

function applyPreference(preference: ThemePreference): void {
  currentPreference = preference;
  document.documentElement.classList.toggle("dark", resolveMode(preference) === "dark");
  notifyThemeChange();
}

/** Reads the persisted theme choice (or the app default) and sets the `.dark`
 *  class. Called on the first useBrowserTokensApi mount; the inline script in
 *  the host HTML (see header comment) does the same synchronously before the
 *  first paint. */
export function applyStoredThemeMode(): void {
  // skip: no document (SSR/non-DOM context), nothing to apply
  if (typeof document === "undefined") return;
  const stored = readStoredPreference();
  if (stored !== undefined) {
    applyPreference(stored);
    // skip: a stored choice wins over the app default
    return;
  }
  // Without a stored choice only an app-declared default changes the HTML state.
  const declared = getComputedStyle(document.documentElement)
    .getPropertyValue(DEFAULT_COLOR_SCHEME_VARIABLE)
    .trim();
  if (isThemePreference(declared)) applyPreference(declared);
}

let storedModeApplied = false;

/** Nur für Tests: der once-per-page-load-Guard ist ein Module-Singleton —
 *  ohne Reset wäre der Mount-Restore-Pfad nach der ersten Render im
 *  Testfile strukturell unerreichbar. */
export function __resetStoredModeAppliedForTests(): void {
  storedModeApplied = false;
  currentPreference = null;
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
  const preference = useSyncExternalStore(
    themeTick.subscribe,
    readCurrentPreference,
    () => "dark" as const,
  );

  // kumiko-lint-ignore no-raw-hooks listener lifecycle, no data fetching
  useEffect(() => {
    // skip: without matchMedia, auto keeps the mode resolved at apply time
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(DARK_SCHEME_QUERY);
    const followSystem = (): void => {
      if (readCurrentPreference() === "auto") applyPreference("auto");
    };
    // The OS scheme may have changed between the first apply and this mount.
    followSystem();
    query.addEventListener("change", followSystem);
    return () => query.removeEventListener("change", followSystem);
  }, []);

  return {
    tokens: cssVarTokens,
    mode,
    preference,
    setPreference: (next) => {
      // skip: no document (SSR/non-DOM context), nothing to apply
      if (typeof document === "undefined") return;
      persistPreference(next);
      applyPreference(next);
    },
    setMode: (next) => {
      // skip: no document (SSR/non-DOM context), nothing to toggle
      if (typeof document === "undefined") return;
      persistPreference(next);
      applyPreference(next);
    },
    toggleMode: () => {
      // skip: no document (SSR/non-DOM context), nothing to toggle
      if (typeof document === "undefined") return;
      const next: ThemeMode = readCurrentMode() === "dark" ? "light" : "dark";
      persistPreference(next);
      applyPreference(next);
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
