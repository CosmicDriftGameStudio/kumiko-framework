// Design-Tokens im shadcn-Namensschema. Werte sind CSS-Variable-
// Referenzen (`var(--color-primary)`) — die echten Zahlen leben in
// styles.css (Web) bzw. in einer StyleSheet.create-Config (Native,
// später). Der Hook ist vor allem für Custom-Components die mal
// einen Token-Wert in eine JS-style-prop schieben müssen; die
// Default-Primitives nutzen direkt Tailwind-Klassen und brauchen
// ihn nicht.
//
// Theme-Toggle läuft über `.dark`-Class auf `<html>` — kein JS-State
// nötig, CSS rendert sofort neu. `useTokenController().toggleTheme()`
// ist nur ein DOM-Wrapper, kein eigener React-State.
//
// Erweiterbar: AppTokens-Interface wie bei Primitives. Dev kann
// eigene Token-Kategorien deklarieren und mit var-Strings befüllen.

import { createContext, type ReactNode, useContext } from "react";

// ---- Core-Token-Types (shadcn-Schema) ----

export type ColorTokens = {
  readonly background: string;
  readonly foreground: string;
  readonly card: string;
  readonly cardForeground: string;
  readonly popover: string;
  readonly popoverForeground: string;
  readonly primary: string;
  readonly primaryForeground: string;
  readonly secondary: string;
  readonly secondaryForeground: string;
  readonly muted: string;
  readonly mutedForeground: string;
  readonly accent: string;
  readonly accentForeground: string;
  readonly destructive: string;
  readonly destructiveForeground: string;
  readonly border: string;
  readonly input: string;
  readonly ring: string;
};

export type RadiusTokens = {
  readonly sm: string;
  readonly md: string;
  readonly lg: string;
  readonly xl: string;
};

export type CoreTokens = {
  readonly color: ColorTokens;
  readonly radius: RadiusTokens;
};

/** Erweiterung für App-eigene Token-Kategorien. Devs augmentieren:
 *
 *    declare module "@kumiko/renderer" {
 *      interface AppTokens {
 *        chart: { gridline: string; line: string };
 *      }
 *    }
 *
 *  Und reichen im App-CSS die passenden `--chart-*` Variablen rein.
 *  Kumikos Default-Primitives nutzen nur CoreTokens. */
// biome-ignore lint/suspicious/noEmptyInterface: extension point for module augmentation
export interface AppTokens {}

export type Tokens = CoreTokens & AppTokens;

export type ThemeMode = "light" | "dark";

export type TokensApi = {
  readonly tokens: Tokens;
  readonly mode: ThemeMode;
  readonly setMode: (mode: ThemeMode) => void;
  readonly toggleMode: () => void;
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

/** Read-only Tokens-Hook. Liefert CSS-var-Strings — nutzbar in
 *  style-Props oder Tailwind-arbitrary-values wie
 *  `bg-[var(--color-primary)]` (selten, die shadcn-Tailwind-Klassen
 *  `bg-primary` sind idiomatischer). */
export function useTokens(): Tokens {
  return useTokenController().tokens;
}

/** Volle API inkl. Theme-Toggle. Für den Dark/Light-Switch-Button. */
export function useTokenController(): TokensApi {
  const api = useContext(TokensContext);
  if (api === undefined) {
    throw new Error(
      "useTokens/useTokenController: no <TokensProvider> mounted. createKumikoApp verdrahtet den Provider automatisch mit @kumiko/renderer-web defaults.",
    );
  }
  return api;
}

/** Tokens mit var-string-Werten. Konstant — die "Werte" sind
 *  Referenzen, die echten Farben ändern sich per CSS ohne dass das
 *  Objekt mutiert werden muss. Plattform-Packages (renderer-web,
 *  -native) importieren das in ihre TokensApi-Impl. */
export const cssVarTokens: Tokens = {
  color: {
    background: "var(--color-background)",
    foreground: "var(--color-foreground)",
    card: "var(--color-card)",
    cardForeground: "var(--color-card-foreground)",
    popover: "var(--color-popover)",
    popoverForeground: "var(--color-popover-foreground)",
    primary: "var(--color-primary)",
    primaryForeground: "var(--color-primary-foreground)",
    secondary: "var(--color-secondary)",
    secondaryForeground: "var(--color-secondary-foreground)",
    muted: "var(--color-muted)",
    mutedForeground: "var(--color-muted-foreground)",
    accent: "var(--color-accent)",
    accentForeground: "var(--color-accent-foreground)",
    destructive: "var(--color-destructive)",
    destructiveForeground: "var(--color-destructive-foreground)",
    border: "var(--color-border)",
    input: "var(--color-input)",
    ring: "var(--color-ring)",
  },
  radius: {
    sm: "var(--radius-sm)",
    md: "var(--radius-md)",
    lg: "var(--radius-lg)",
    xl: "var(--radius-xl)",
  },
} as Tokens;
