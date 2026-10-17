import { HEX_COLOR_PATTERN } from "./constants.js";
import { type MailLayoutMeta, readMailLayoutMeta } from "./template-meta.js";

// Every value is a member of a closed set, so it can be written into MJML and inline styles as is.
export type MailLayoutAppearance = {
  readonly width: number;
  readonly fontFamily: string;
  readonly outerBackground: string;
  readonly accentLine: boolean;
  readonly buttonStyle: string;
};

const FONT_FAMILIES = {
  sans: "Arial, Helvetica, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
} as const;

const BUTTON_COLOR = "#1f5468";
const BUTTON_BASE = "display:inline-block;padding:10px 20px;font-weight:600;text-decoration:none";

const BUTTON_STYLES = {
  "filled-rounded": `${BUTTON_BASE};border-radius:6px;background-color:${BUTTON_COLOR};color:#ffffff`,
  "filled-square": `${BUTTON_BASE};background-color:${BUTTON_COLOR};color:#ffffff`,
  outline: `${BUTTON_BASE};border:2px solid ${BUTTON_COLOR};border-radius:6px;color:${BUTTON_COLOR}`,
} as const;

export function isHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

export function mailLayoutAppearance(meta: MailLayoutMeta | unknown): MailLayoutAppearance {
  const parsed = readMailLayoutMeta(meta);
  return {
    width: parsed.width ?? 600,
    fontFamily: FONT_FAMILIES[parsed.font ?? "sans"],
    outerBackground: parsed.outerBackground ?? "#f5f5f5",
    accentLine: (parsed.accentLine ?? "none") === "branding",
    buttonStyle: BUTTON_STYLES[parsed.buttonStyle ?? "filled-rounded"],
  };
}
