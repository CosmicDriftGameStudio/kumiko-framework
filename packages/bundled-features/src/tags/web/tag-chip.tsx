// @runtime client
// TagChip — read-only colored label pill, GitLab-labels style. The tag's `color`
// (a hex like "#22cc88") drives the background; the text color is chosen for
// contrast (YIQ luminance) so light and dark labels both stay legible. A tag
// with no usable color falls back to a neutral chip. Self-contained inline
// styles (pattern from config-source-badge.tsx) so it renders the same in the
// picker, on cards and in screenshots without depending on Tailwind tokens.

import type { CSSProperties, ReactNode } from "react";

// YIQ perceived brightness → black text on light backgrounds, white on dark.
// Returns null for anything that isn't a #rgb/#rrggbb hex so the caller can use
// its neutral fallback (color is a free-text UI hint, never validated).
export function contrastText(color: string): "#000000" | "#ffffff" | null {
  const rgb = hexToRgb(color);
  if (rgb === null) return null;
  const yiq = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return yiq >= 128 ? "#000000" : "#ffffff";
}

function hexToRgb(color: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color.trim());
  if (match === null) return null;
  const short = match[1] as string;
  const hex =
    short.length === 3
      ? `${short[0]}${short[0]}${short[1]}${short[1]}${short[2]}${short[2]}`
      : short;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

const BASE_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0 8px",
  fontSize: "12px",
  fontWeight: 500,
  lineHeight: "20px",
  borderRadius: "9999px",
  whiteSpace: "nowrap",
};

const NEUTRAL = { backgroundColor: "#e5e7eb", color: "#374151" } as const;

export function TagChip({
  name,
  color,
}: {
  readonly name: string;
  readonly color?: string | null;
}): ReactNode {
  const fg = color != null && color !== "" ? contrastText(color) : null;
  const palette = fg !== null && color != null ? { backgroundColor: color, color: fg } : NEUTRAL;
  return (
    <span data-testid="tag-chip" style={{ ...BASE_STYLE, ...palette }}>
      {name}
    </span>
  );
}
