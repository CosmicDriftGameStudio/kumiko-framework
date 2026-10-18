import { HEX_COLOR_PATTERN } from "./constants.ts";
import { type MailLayoutMeta, readMailLayoutMeta } from "./template-meta.ts";

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

const DEFAULT_BUTTON_COLOR = "#1f5468";
const BUTTON_BASE = "display:inline-block;padding:10px 20px;font-weight:600;text-decoration:none";

type ButtonStyle = NonNullable<MailLayoutMeta["buttonStyle"]>;

function buttonStyleCss(style: ButtonStyle, color: string): string {
  switch (style) {
    case "filled-rounded":
      return `${BUTTON_BASE};border-radius:6px;background-color:${color};color:#ffffff`;
    case "filled-square":
      return `${BUTTON_BASE};background-color:${color};color:#ffffff`;
    case "outline":
      return `${BUTTON_BASE};border:2px solid ${color};border-radius:6px;color:${color}`;
  }
}

export function isHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

// The branding accent colors the buttons only where the layout opted into the branding accent line.
export function mailLayoutAppearance(
  meta: MailLayoutMeta | unknown,
  brandingAccentColor?: string,
): MailLayoutAppearance {
  const parsed = readMailLayoutMeta(meta);
  const accentLine = (parsed.accentLine ?? "none") === "branding";
  const buttonColor =
    accentLine && brandingAccentColor !== undefined && isHexColor(brandingAccentColor)
      ? brandingAccentColor
      : DEFAULT_BUTTON_COLOR;
  return {
    width: parsed.width ?? 600,
    fontFamily: FONT_FAMILIES[parsed.font ?? "sans"],
    outerBackground: parsed.outerBackground ?? "#f5f5f5",
    accentLine,
    buttonStyle: buttonStyleCss(parsed.buttonStyle ?? "filled-rounded", buttonColor),
  };
}
