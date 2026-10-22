// Design tokens using the shadcn naming scheme. Values are CSS variable
// references (`var(--color-primary)`); the actual values live in
// styles.css (Web) or a StyleSheet.create configuration (Native,
// later). The hook is mainly for custom components that need to pass a
// token value to a JS style prop; the default primitives use Tailwind
// classes directly and do not need it.
//
// Theme toggling uses the `.dark` class on `<html>`, so no JS state is
// needed and CSS updates immediately. `useTokenController().toggleTheme()`
// is only a DOM wrapper, not separate React state.
//
// Extensible: augment the AppTokens interface as with primitives. Apps can
// declare custom token categories and populate them with var strings.

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

export type FontTokens = {
  readonly sans: string;
  readonly heading: string;
  readonly mono: string;
};

export type ShadowTokens = {
  readonly card: string;
};

export type SpacingTokens = {
  readonly card: string;
};

export type CoreTokens = {
  readonly color: ColorTokens;
  readonly radius: RadiusTokens;
  readonly font: FontTokens;
  readonly shadow: ShadowTokens;
  readonly spacing: SpacingTokens;
};

/** Extension point for app-specific token categories. Augment it, for example:
 *
 *    declare module "@cosmicdrift/kumiko-renderer" {
 *      interface AppTokens {
 *        chart: { gridline: string; line: string };
 *      }
 *    }
 *
 *  Then provide the matching `--chart-*` variables in the app's CSS.
 *  Kumiko's default primitives use only CoreTokens. */
// biome-ignore lint/suspicious/noEmptyInterface: extension point for module augmentation
export interface AppTokens {}

export type Tokens = CoreTokens & AppTokens;

export type ThemeMode = "light" | "dark";

/** "auto" follows the OS color scheme live; light/dark are explicit choices. */
export type ThemePreference = ThemeMode | "auto";

export type TokensApi = {
  readonly tokens: Tokens;
  /** The scheme currently applied (resolved from the preference when it is "auto"). */
  readonly mode: ThemeMode;
  /** Optional so hand-built TokensApi values (tests, custom providers) stay valid:
   *  absent means a plain light/dark implementation, read as `mode`. */
  readonly preference?: ThemePreference;
  readonly setPreference?: (preference: ThemePreference) => void;
  /** Explicit choice: leaves "auto". */
  readonly setMode: (mode: ThemeMode) => void;
  /** Explicit flip of the resolved mode: leaves "auto". */
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

/** Read-only tokens hook. Provides CSS variable strings for use in
 *  style props or Tailwind arbitrary values such as
 *  `bg-[var(--color-primary)]` (rarely needed; the shadcn Tailwind class
 *  `bg-primary` is more idiomatic). */
export function useTokens(): Tokens {
  return useTokenController().tokens;
}

/** Full API including theme toggling, for a dark/light switch button. */
export function useTokenController(): TokensApi {
  const api = useContext(TokensContext);
  if (api === undefined) {
    throw new Error(
      "useTokens/useTokenController: no <TokensProvider> mounted. createKumikoApp verdrahtet den Provider automatisch mit @cosmicdrift/kumiko-renderer/web defaults.",
    );
  }
  return api;
}

/** Tokens with var-string values. Constant: the "values" are references,
 *  the real colors change via CSS without mutating the object. Platform
 *  bindings (renderer/web) import it into their TokensApi impl. */
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
  font: {
    sans: "var(--font-sans)",
    heading: "var(--font-heading)",
    mono: "var(--font-mono)",
  },
  shadow: {
    card: "var(--card-shadow)",
  },
  spacing: {
    card: "var(--card-padding)",
  },
} as Tokens;
