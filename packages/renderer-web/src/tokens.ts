import { cssVarTokens, type ThemeMode, type Tokens, type TokensApi } from "@kumiko/renderer";
import { useSyncExternalStore } from "react";

// Web-spezifische TokensApi-Impl. Theme-Toggle via `.dark`-Class auf
// <html>. Die echten Farben leben in styles.css; hier ist nur die
// JS-Seite die den class-switch triggert und React-Consumer mit
// useSyncExternalStore darüber informiert.

const THEME_EVENT = "kumiko:theme-change";

function readCurrentMode(): ThemeMode {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function notifyThemeChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(THEME_EVENT));
}

function subscribeThemeChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(THEME_EVENT, cb);
  return () => window.removeEventListener(THEME_EVENT, cb);
}

/** Hook der eine TokensApi für den Browser baut. Wird von
 *  createKumikoApp genutzt; App-Code der einen eigenen Token-State
 *  braucht (z.B. User-Präferenz aus localStorage) kann selber
 *  `<TokensProvider value={...}>` mounten. */
export function useBrowserTokensApi(): TokensApi {
  const mode = useSyncExternalStore(subscribeThemeChange, readCurrentMode, () => "dark" as const);
  return {
    tokens: cssVarTokens,
    mode,
    setMode: (next) => {
      if (typeof document === "undefined") return;
      document.documentElement.classList.toggle("dark", next === "dark");
      notifyThemeChange();
    },
    toggleMode: () => {
      if (typeof document === "undefined") return;
      document.documentElement.classList.toggle("dark");
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
