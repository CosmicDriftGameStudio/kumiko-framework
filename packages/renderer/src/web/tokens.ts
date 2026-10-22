import { useEffect, useState, useSyncExternalStore } from "react";
import { createStore } from "../headless/index.ts";
import {
  cssVarTokens,
  type ThemeMode,
  type ThemePreference,
  type Tokens,
  type TokensApi,
} from "../index.ts";
import { DEFAULT_COLOR_SCHEME_VARIABLE } from "./default-color-scheme.ts";

// Web-specific TokensApi implementation. The theme toggle uses the `.dark` class on
// <html>. The actual colors live in styles.css; this is only the JS side that triggers
// the class switch and informs React consumers through useSyncExternalStore.
//
// The DOM (`<html class="dark">`) is the source of truth; the store is only a
// notification bus (a tick counter) incremented by setMode/toggleMode on every class
// change. This keeps the DOM class as the sole authority—readCurrentMode reads it
// freshly on every getSnapshot.
//
// Persistence: the choice is stored in localStorage (THEME_STORAGE_KEY) and restored
// on the first hook mount; without it, the toggle would be lost on every reload.
// Preference: "auto" follows prefers-color-scheme live (matchMedia listener), while
// "light"/"dark" are explicit choices and take precedence. Without a stored choice,
// AppTheme.defaultColorScheme (CSS variable) applies; otherwise, the HTML state.
//
// To prevent FOUC, the host HTML also needs a synchronous inline script BEFORE the
// stylesheet link. Under a strict CSP, its hash is the sha256 in the build's
// csp-hashes.json, which runProdApp also passes to hostDispatch as
// deps.cspScriptHashes:
//
//   <script>try{var s=localStorage.getItem("kumiko:theme");
//     if(s==="dark"||(s==="auto"&&matchMedia("(prefers-color-scheme: dark)").matches))
//     document.documentElement.classList.add("dark")}catch(e){}</script>
//
// The script runs before the stylesheet, so it cannot read the
// --kumiko-default-color-scheme variable. An app with AppTheme.defaultColorScheme
// copies that value in as a literal fallback ("dark" or "auto" here):
//
//   <script>try{var s=localStorage.getItem("kumiko:theme")||"dark";
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

function readDeclaredDefaultPreference(): ThemePreference | undefined {
  const declared = getComputedStyle(document.documentElement)
    .getPropertyValue(DEFAULT_COLOR_SCHEME_VARIABLE)
    .trim();
  return isThemePreference(declared) ? declared : undefined;
}

function readDefaultPreference(): ThemePreference {
  return readDeclaredDefaultPreference() ?? readCurrentMode();
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
    // skip: localStorage can throw (private mode/quota); the theme then remains
    // session-based, but the class toggle still works.
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
  const declared = readDeclaredDefaultPreference();
  if (declared !== undefined) applyPreference(declared);
}

let storedModeApplied = false;

/** Tests only: the once-per-page-load guard is a module singleton; without a reset,
 *  the mount-restore path would be structurally unreachable after the first render
 *  in the test file. */
export function __resetStoredModeAppliedForTests(): void {
  storedModeApplied = false;
  currentPreference = null;
}

/** Builds a TokensApi for the browser. Used by createKumikoApp; app code that needs
 *  its own token state (for example, a user preference from localStorage) can mount
 *  its own `<TokensProvider value={...}>`. */
export function useBrowserTokensApi(): TokensApi {
  // Apply the stored choice once per page load. This is lazy rather than a module
  // side effect so importing without a DOM (SSR/tests) remains safe.
  // A useState lazy initializer is used instead of placing this directly in the
  // render body because the DOM side effect could otherwise run during a discarded
  // concurrent render (React may repeat or abandon render bodies).
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

/** Default tokens—identical to `cssVarTokens` (variable-string references).
 *  Light and dark values switch via the `.dark` class on <html>. */
export const defaultTokens: Tokens = cssVarTokens;
export const lightTokens: Tokens = cssVarTokens;

/** Historically wrote tokens to :root as CSS variables. Now a no-op—the CSS
 *  variables live in styles.css, not JS. Retained as an export so existing app code
 *  does not break. */
export function applyTokensToCssVars(_tokens: Tokens): void {
  // Intentionally empty—see the comment above.
}
