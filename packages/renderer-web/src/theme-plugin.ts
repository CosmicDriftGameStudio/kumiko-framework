import plugin from "tailwindcss/plugin";

export const FRAMEWORK_COLOR_NAMES = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
  "status-ok",
  "status-warn",
  "status-bad",
  "status-critical",
  "syntax-key",
  "syntax-string",
  "syntax-number",
  "syntax-literal",
  "promo",
  "promo-foreground",
  "promo-accent",
  "promo-accent-foreground",
] as const;

export type FrameworkColorName = (typeof FRAMEWORK_COLOR_NAMES)[number];

/** A plain string applies to both modes; `dark` falls back to `light`. */
export type ThemeColorValue = string | { readonly light: string; readonly dark?: string };

export type AppTheme = {
  readonly colors?: Readonly<Partial<Record<FrameworkColorName | (string & {}), ThemeColorValue>>>;
  /** Base radius; the sm/md/lg/xl scale derives from it. */
  readonly radius?: string;
  readonly fonts?: {
    readonly sans?: string;
    readonly heading?: string;
    readonly mono?: string;
  };
  readonly shadows?: { readonly card?: string };
  readonly spacing?: { readonly card?: string };
};

type CssDeclarations = Record<string, string>;

type ThemeCss = {
  readonly light: CssDeclarations;
  readonly dark: CssDeclarations;
  readonly modeInvariant: CssDeclarations;
  readonly extraColorUtilities: CssDeclarations;
  readonly bodyFontFamily: string | undefined;
};

const COLOR_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const frameworkColorNames: ReadonlySet<string> = new Set(FRAMEWORK_COLOR_NAMES);

export function defineAppTheme<Theme extends AppTheme>(theme: Theme): Theme {
  return theme;
}

export function buildThemeCss(theme: AppTheme): ThemeCss {
  return {
    ...buildColorDeclarations(theme.colors ?? {}),
    modeInvariant: buildModeInvariantDeclarations(theme),
    bodyFontFamily: theme.fonts?.sans === undefined ? undefined : "var(--font-sans)",
  };
}

function buildColorDeclarations(
  colors: NonNullable<AppTheme["colors"]>,
): Pick<ThemeCss, "light" | "dark" | "extraColorUtilities"> {
  const light: CssDeclarations = {};
  const dark: CssDeclarations = {};
  const extraColorUtilities: CssDeclarations = {};
  for (const [name, value] of Object.entries(colors)) {
    if (value === undefined) continue;
    if (!COLOR_NAME_PATTERN.test(name)) {
      throw new Error(`[kumiko theme] color name "${name}" must be kebab-case (e.g. "brand-soft")`);
    }
    const variable = `--color-${name}`;
    const lightValue = typeof value === "string" ? value : value.light;
    light[variable] = lightValue;
    dark[variable] = typeof value === "string" ? value : (value.dark ?? lightValue);
    if (!frameworkColorNames.has(name)) extraColorUtilities[name] = `var(${variable})`;
  }
  return { light, dark, extraColorUtilities };
}

function buildModeInvariantDeclarations(theme: AppTheme): CssDeclarations {
  const modeInvariant: CssDeclarations = {};
  if (theme.radius !== undefined) modeInvariant["--radius"] = theme.radius;
  if (theme.fonts?.sans !== undefined) modeInvariant["--font-sans"] = theme.fonts.sans;
  if (theme.fonts?.heading !== undefined) modeInvariant["--font-heading"] = theme.fonts.heading;
  if (theme.fonts?.mono !== undefined) modeInvariant["--font-mono"] = theme.fonts.mono;
  if (theme.shadows?.card !== undefined) modeInvariant["--card-shadow"] = theme.shadows.card;
  if (theme.spacing?.card !== undefined) modeInvariant["--card-padding"] = theme.spacing.card;
  return modeInvariant;
}

// The framework's light palette sits in `@layer base :root:not(.dark)`, which beats any app
// `@theme` value. addBase emits into the same base layer after the framework's import, so the
// same selectors here win by source order without the app repeating its palette in `:root`.
export function createThemePlugin(theme: AppTheme): ReturnType<typeof plugin> {
  const css = buildThemeCss(theme);
  return plugin(
    ({ addBase }) => {
      addBase({
        ":root": { ...css.modeInvariant },
        ":root:not(.dark)": { ...css.light },
        ".dark": { ...css.dark },
        ...(css.bodyFontFamily === undefined
          ? {}
          : { body: { "font-family": css.bodyFontFamily } }),
      });
    },
    { theme: { extend: { colors: { ...css.extraColorUtilities } } } },
  );
}
