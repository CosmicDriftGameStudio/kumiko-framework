import {
  isHexColor,
  MAIL_TONES,
  type MailTone,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { escapeHtml, escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";

export type ToneColors = { readonly bar: string; readonly fg: string; readonly soft: string };

const FIXED_TONES: Readonly<Record<Exclude<MailTone, "accent">, ToneColors>> = {
  info: { bar: "#7C8DB5", fg: "#3E4C70", soft: "#EEF1F7" },
  success: { bar: "#22B35E", fg: "#0E7A3E", soft: "#E8F7EE" },
  warning: { bar: "#F2B53A", fg: "#8A4B00", soft: "#FEF4E2" },
  danger: { bar: "#E5484D", fg: "#A1161B", soft: "#FDECEC" },
  neutral: { bar: "#8B919C", fg: "#4A515E", soft: "#F1F2F0" },
};

export const DEFAULT_ACCENT_COLOR = "#1f5468";
const INK = "#0B0D12";
const MUTED = "#5A6170";
const LOGO_HEIGHT_PX = 28;

// The rendered meta value is author input: only a known tone name selects colors.
export function readMailTone(rendered: string | undefined): MailTone | undefined {
  const value = rendered?.trim().toLowerCase();
  return isOneOf(MAIL_TONES, value) ? value : undefined;
}

function tintTowardsWhite(hex: string, whiteShare: number): string {
  const channel = (offset: number): string => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16);
    const mixed = Math.round(value + (255 - value) * whiteShare);
    return mixed.toString(16).padStart(2, "0");
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

export function toneColors(tone: MailTone, accentColor: string | undefined): ToneColors {
  if (tone !== "accent") return FIXED_TONES[tone];
  const accent =
    accentColor !== undefined && isHexColor(accentColor) ? accentColor : DEFAULT_ACCENT_COLOR;
  return { bar: accent, fg: accent, soft: tintTowardsWhite(accent, 0.9) };
}

function tenantInitial(tenantName: string): string {
  const first = Array.from(tenantName.trim())[0];
  return first === undefined ? "" : first.toLocaleUpperCase();
}

// Logo (or an initial tile in the accent color), tenant name and an optional suffix in one row.
export function brandHeaderHtml(input: {
  readonly tenantName: string;
  readonly suffix: string;
  readonly logoSrc: string | undefined;
  readonly accentColor: string;
}): string {
  const initial = tenantInitial(input.tenantName);
  const tileColor = isHexColor(input.accentColor) ? input.accentColor : DEFAULT_ACCENT_COLOR;
  const mark =
    input.logoSrc !== undefined
      ? `<img src="${escapeHtmlAttr(input.logoSrc)}" alt="" height="${LOGO_HEIGHT_PX}" style="height:${LOGO_HEIGHT_PX}px;width:auto;max-width:140px;border:0;vertical-align:middle;margin:0 10px 0 0">`
      : initial === ""
        ? ""
        : `<span style="display:inline-block;width:${LOGO_HEIGHT_PX}px;height:${LOGO_HEIGHT_PX}px;line-height:${LOGO_HEIGHT_PX}px;text-align:center;border-radius:8px;background:${escapeHtmlAttr(tileColor)};color:#ffffff;font-weight:700;font-size:14px;vertical-align:middle;margin:0 10px 0 0">${escapeHtml(initial)}</span>`;
  const name =
    input.tenantName.trim() === ""
      ? ""
      : `<span style="vertical-align:middle;font-size:15px;font-weight:600;color:${INK}">${escapeHtml(input.tenantName)}</span>`;
  const suffix =
    input.suffix.trim() === ""
      ? ""
      : ` <span style="vertical-align:middle;font-size:13px;color:${MUTED}">${escapeHtml(input.suffix)}</span>`;
  return `${mark}${name}${suffix}`;
}

function chipHtml(label: string, colors: ToneColors): string {
  return `<span style="display:inline-block;font-size:12px;font-weight:600;line-height:1.4;color:${escapeHtmlAttr(colors.fg)};background:${escapeHtmlAttr(colors.soft)};padding:4px 10px;border-radius:999px;white-space:nowrap"><span style="display:inline-block;width:6px;height:6px;border-radius:999px;background:${escapeHtmlAttr(colors.bar)};margin:0 6px 1px 0;vertical-align:middle"></span>${escapeHtml(label)}</span>`;
}

// A table instead of two mj-columns: columns stack on narrow screens, the chip belongs beside the brand.
export function headerRowHtml(leftHtml: string, chipLabel: string, colors: ToneColors): string {
  if (chipLabel.trim() === "") return leftHtml;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="left" style="vertical-align:middle">${leftHtml}</td><td align="right" style="vertical-align:middle">${chipHtml(chipLabel, colors)}</td></tr></table>`;
}
