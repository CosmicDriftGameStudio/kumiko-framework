// @runtime client
// Mirrors the mail-layout meta of template-resolver (template-meta.ts); the server parses it again on every write and render.

export const LAYOUT_WIDTHS = [560, 600, 640] as const;
export const LAYOUT_FONTS = ["sans", "serif"] as const;
export const LAYOUT_ACCENT_LINES = ["branding", "none"] as const;
export const LAYOUT_BUTTON_STYLES = ["filled-rounded", "filled-square", "outline"] as const;

export type LayoutWidth = (typeof LAYOUT_WIDTHS)[number];
export type LayoutFont = (typeof LAYOUT_FONTS)[number];
export type LayoutAccentLine = (typeof LAYOUT_ACCENT_LINES)[number];
export type LayoutButtonStyle = (typeof LAYOUT_BUTTON_STYLES)[number];

/** What the server stores; every field is optional and a missing one means the default. */
export type LayoutMeta = {
  readonly width?: LayoutWidth;
  readonly font?: LayoutFont;
  readonly outerBackground?: string;
  readonly accentLine?: LayoutAccentLine;
  readonly buttonStyle?: LayoutButtonStyle;
};

/** The five appearance values with defaults applied; `outerBackground` stays text while it is being typed. */
export type LayoutAppearance = {
  readonly width: LayoutWidth;
  readonly font: LayoutFont;
  readonly outerBackground: string;
  readonly accentLine: LayoutAccentLine;
  readonly buttonStyle: LayoutButtonStyle;
};

export const DEFAULT_LAYOUT_APPEARANCE: LayoutAppearance = {
  width: 600,
  font: "sans",
  outerBackground: "#f5f5f5",
  accentLine: "none",
  buttonStyle: "filled-rounded",
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

export function appearanceOf(meta: LayoutMeta): LayoutAppearance {
  return { ...DEFAULT_LAYOUT_APPEARANCE, ...meta };
}

/** Keeps a field that was already stored, even when it now equals the default; drops every other default. */
export function metaToSave(appearance: LayoutAppearance, stored: LayoutMeta): LayoutMeta {
  const defaults = DEFAULT_LAYOUT_APPEARANCE;
  const keep = (key: keyof LayoutAppearance): boolean =>
    appearance[key] !== defaults[key] || key in stored;
  return {
    ...(keep("width") && { width: appearance.width }),
    ...(keep("font") && { font: appearance.font }),
    ...(keep("outerBackground") && { outerBackground: appearance.outerBackground }),
    ...(keep("accentLine") && { accentLine: appearance.accentLine }),
    ...(keep("buttonStyle") && { buttonStyle: appearance.buttonStyle }),
  };
}
