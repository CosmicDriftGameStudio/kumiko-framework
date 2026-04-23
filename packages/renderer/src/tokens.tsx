// Design-Tokens für Kumikos Rendering-Stack. Plattformneutrales
// TypeScript-Objekt — weder CSS-Variables noch Tailwind-Klassen.
// Die Plattform-Packages übersetzen:
//
//   @kumiko/renderer-web   : spiegelt Tokens auf :root CSS-Variables
//   @kumiko/renderer-native: nutzt Tokens direkt in StyleSheet.create
//
// Tokens sind die SSOT für visuelle Konstanten. `useTokens()` liefert
// den aktuellen Wert (read-only); `useTokenController()` liefert
// zusätzlich den Setter für Runtime-Toggles (Dark/Light, Compact-
// Mode etc.). Der Provider-Wert ist stateful — wer Tokens ändert,
// triggert ein Re-render aller useTokens()-Consumer.
//
// Erweiterbar: analog zu `AppPrimitives` können Apps `AppTokens` via
// Module-Augmentation mit eigenen Kategorien füllen (chart, brand,
// whatever). Die Web-Spiegelung schreibt alle string-Leafs rekursiv
// als CSS-Vars, so dass Custom-Tokens ohne weiteren Aufwand über
// `var(--kumiko-<path>)` verfügbar sind.

import { createContext, type ReactNode, useContext } from "react";

// ---- Core-Token-Types ----

export type ColorTokens = {
  /** App-Hintergrund — unterste Ebene. */
  readonly background: string;
  /** Karten/Panel-Hintergrund — eine Ebene über background. */
  readonly surface: string;
  /** Default-Textfarbe. Lesbar auf background UND surface. */
  readonly text: string;
  /** Gedämpfte Textfarbe für Labels, Platzhaltertexte, Metainfos. */
  readonly textMuted: string;
  /** Trennlinien, Input-Rand, Section-Divider. */
  readonly border: string;
  /** Primary (Save-Button, aktiver Nav-Tab). */
  readonly primary: { readonly background: string; readonly text: string };
  /** Danger (Delete-Button, Fehler-Banner). */
  readonly danger: { readonly background: string; readonly text: string };
  /** Success (rar — für Success-Toasts reserviert). */
  readonly success: { readonly background: string; readonly text: string };
};

export type SpacingTokens = {
  readonly xs: string;
  readonly sm: string;
  readonly md: string;
  readonly lg: string;
  readonly xl: string;
};

export type RadiusTokens = {
  readonly sm: string;
  readonly md: string;
};

export type FontSizeTokens = {
  readonly body: string;
  readonly small: string;
  readonly heading: string;
};

export type CoreTokens = {
  readonly color: ColorTokens;
  readonly spacing: SpacingTokens;
  readonly radius: RadiusTokens;
  readonly fontSize: FontSizeTokens;
};

/** Offene Extension-Zone für App-eigene Token-Kategorien. Devs
 *  erweitern dieses Interface via TypeScript Module-Augmentation:
 *
 *    declare module "@kumiko/renderer" {
 *      interface AppTokens {
 *        chart: { gridline: string; bg: string };
 *        brand: { accent: string };
 *      }
 *    }
 *
 *  Nach der Augmentation tauchen die Keys in `Tokens` auf, lassen
 *  sich via `createKumikoApp({ tokens: { chart: {...} } })` setzen
 *  und werden automatisch als `--kumiko-chart-gridline` etc. auf
 *  CSS-Variablen gespiegelt. */
// biome-ignore lint/suspicious/noEmptyInterface: extension point for module augmentation
export interface AppTokens {}

export type Tokens = CoreTokens & AppTokens;

/** Deep-Partial über die komplette Token-Struktur. Alle Leafs werden
 *  optional, alle Zwischenknoten sind rekursiv partial. Funktioniert
 *  automatisch auch für AppTokens-Erweiterungen. */
export type TokensOverride = DeepPartial<Tokens>;

type DeepPartial<T> = {
  readonly [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

// ---- Controller-API ----

export type TokensApi = {
  readonly tokens: Tokens;
  /** Wendet ein Partial-Override auf die aktuellen Tokens an.
   *  Mehrere Setter sind additiv — nachfolgende Aufrufe mergen auf
   *  den aktuellen State, nicht auf den Bootstrap-Default. */
  readonly setTokens: (override: TokensOverride) => void;
};

// ---- Context + Provider + Hooks ----

const TokensContext = createContext<TokensApi | undefined>(undefined);

export type TokensProviderProps = {
  readonly children: ReactNode;
  readonly value: TokensApi;
};

export function TokensProvider({ children, value }: TokensProviderProps): ReactNode {
  return <TokensContext.Provider value={value}>{children}</TokensContext.Provider>;
}

/** Read-only Tokens-Hook. Liefert den aktuellen Wert, re-rendert
 *  bei State-Change. Für Consumer die nur lesen (Custom-Components
 *  mit Canvas-Rendering, Chart-Farben). */
export function useTokens(): Tokens {
  return useTokenController().tokens;
}

/** Volle API inkl. `setTokens`. App-Code der einen Theme-Toggle
 *  baut nutzt diesen Hook. */
export function useTokenController(): TokensApi {
  const api = useContext(TokensContext);
  if (api === undefined) {
    throw new Error(
      "useTokens/useTokenController: no <TokensProvider> mounted. Wrap your app in one (createKumikoApp does this for you with defaultTokens from @kumiko/renderer-web).",
    );
  }
  return api;
}

// ---- Deep-Merge Helper ----

/** Generisches Deep-Merge für Tokens. Behandelt beliebig tief
 *  verschachtelte Objekt-Strukturen, inklusive AppTokens-Extensions.
 *  Arrays und null werden als Leafs behandelt (replaced, nicht
 *  merged) — Kumikos Tokens haben keine Arrays, sollte später was
 *  dazukommen, ist der Type-Guard die Stelle.
 *
 *  Invariant: das Ergebnis ist ein vollständiges `Tokens`-Object,
 *  keine Keys entfallen. Override darf Leafs überschreiben, aber
 *  nicht wegbekommen. */
export function mergeTokens(base: Tokens, override: TokensOverride | undefined): Tokens {
  if (override === undefined) return base;
  return deepMerge(base, override) as Tokens;
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = deepMerge((base as Record<string, unknown>)[key], value);
  }
  return result;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
