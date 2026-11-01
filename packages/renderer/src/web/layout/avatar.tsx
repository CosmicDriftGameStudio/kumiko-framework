// Avatar pill with initials. The color is based on a string hash so the same
// user always gets the same color (linear pattern). Eight hue targets provide
// good distinction without making the sidebar overly colorful.
//
// Usage: `<Avatar id="user-123" label="Daniel Hennig" size="md" />`.
// `id` is the color's hash source; `label` is used for initials and the
// aria-label. There is no image slot yet; one follows once apps provide real
// avatar URLs.

import { type ReactNode, useMemo } from "react";
import { cn } from "../lib/cn.ts";

export type AvatarSize = "xs" | "sm" | "md" | "lg";
export type AvatarShape = "square" | "round";

export type AvatarProps = {
  /** Stable identifier—the source for the background-color hash. Usually
   *  `user.id`; for avatars based only on a label, the label string can also
   *  be used. */
  readonly id: string;
  /** Full name or email—the initials are extracted from this value. */
  readonly label: string;
  readonly size?: AvatarSize;
  /** Default square; round suits inline presence markers. */
  readonly shape?: AvatarShape;
  readonly testId?: string;
};

// Tailwind classes for each hue. Background lightness is moderate (550–600)
// for saturation, while foreground lightness is high (50–100) for contrast.
// Fixed colors keep avatar colors deterministic and independent of the theme,
// even though the tokens work in both modes through CSS variables.
const COLOR_CLASSES = [
  "bg-rose-600 text-rose-50",
  "bg-orange-600 text-orange-50",
  "bg-amber-600 text-amber-50",
  "bg-emerald-600 text-emerald-50",
  "bg-teal-600 text-teal-50",
  "bg-sky-600 text-sky-50",
  "bg-indigo-600 text-indigo-50",
  "bg-fuchsia-600 text-fuchsia-50",
] as const;

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: "size-[18px] text-[9px]",
  sm: "size-5 text-[10px]",
  md: "size-6 text-[11px]",
  lg: "size-8 text-xs",
} satisfies Record<AvatarSize, string>;

function hashCode(str: string): number {
  // A djb2 variant: fast and sufficiently well distributed for 8 buckets.
  // A cryptographic hash would be overkill for color bucketing.
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pickColor(id: string): string {
  const idx = hashCode(id) % COLOR_CLASSES.length;
  return COLOR_CLASSES[idx] ?? COLOR_CLASSES[0] ?? "bg-muted";
}

function extractInitials(label: string): string {
  // "Daniel Hennig" → "DH". "alice@example.com" → "AL". For a single word,
  // it falls back to the first 2 letters ("Daniel" → "DA"). Everything is
  // upper-case.
  const trimmed = label.trim();
  if (trimmed.length === 0) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return `${(parts[0]?.[0] ?? "").toUpperCase()}${(parts[1]?.[0] ?? "").toUpperCase()}`;
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export function Avatar({
  id,
  label,
  size = "md",
  shape = "square",
  testId,
}: AvatarProps): ReactNode {
  const colorClass = useMemo(() => pickColor(id), [id]);
  const initials = useMemo(() => extractInitials(label), [label]);
  return (
    <span
      data-testid={testId}
      role="img"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-semibold uppercase select-none",
        shape === "round" ? "rounded-full" : "rounded",
        SIZE_CLASSES[size],
        colorClass,
      )}
    >
      {initials}
    </span>
  );
}
