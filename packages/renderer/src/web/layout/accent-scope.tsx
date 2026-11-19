import type { CSSProperties, ReactElement, ReactNode } from "react";

// Only hex colors pass, so tenant branding data can never inject other CSS through the style object.
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const LIGHT_FOREGROUND = "#ffffff";
const DARK_FOREGROUND = "#1a1c1e";

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function hexLuminance(hex: string): number {
  const digits = hex.slice(1);
  const rgb = digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits.slice(0, 6);
  const red = channelLuminance(Number.parseInt(rgb.slice(0, 2), 16));
  const green = channelLuminance(Number.parseInt(rgb.slice(2, 4), 16));
  const blue = channelLuminance(Number.parseInt(rgb.slice(4, 6), 16));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function readableForeground(accent: string): string {
  const accentLuminance = hexLuminance(accent);
  return contrastRatio(accentLuminance, hexLuminance(LIGHT_FOREGROUND)) >=
    contrastRatio(accentLuminance, hexLuminance(DARK_FOREGROUND))
    ? LIGHT_FOREGROUND
    : DARK_FOREGROUND;
}

/** Theme variables that tint a subtree with `color`; undefined unless `color` is a hex color. */
export function accentColorVars(color: string): CSSProperties | undefined {
  const accent = color.trim();
  if (!HEX_COLOR.test(accent)) return undefined;
  return {
    "--color-primary": accent,
    "--color-ring": accent,
    "--color-primary-foreground": readableForeground(accent),
  };
}

export type AccentScopeProps = {
  /** Tenant accent as #rgb, #rrggbb or #rrggbbaa; any other value keeps the theme colors. */
  readonly color: string;
  readonly className?: string;
  readonly testId?: string;
  readonly children: ReactNode;
};

export function AccentScope({
  color,
  className,
  testId,
  children,
}: AccentScopeProps): ReactElement {
  return (
    <div className={className} data-testid={testId} style={accentColorVars(color)}>
      {children}
    </div>
  );
}
