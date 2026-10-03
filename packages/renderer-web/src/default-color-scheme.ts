export type DefaultColorScheme = "auto" | "light" | "dark";

// Written by createThemePlugin, read by the browser tokens hook. A separate
// module keeps tailwindcss/plugin out of the client bundle.
export const DEFAULT_COLOR_SCHEME_VARIABLE = "--kumiko-default-color-scheme";
