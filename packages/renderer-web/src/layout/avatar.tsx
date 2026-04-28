// Avatar-Pill mit Initials. Color-coded background basierend auf
// string-hash damit der gleiche User immer dieselbe Farbe bekommt
// (Linear-Pattern). 8 Hue-Targets für gute Distinktion ohne über-
// bunte Sidebar.
//
// Nutzung: `<Avatar id="user-123" label="Daniel Hennig" size="md" />`.
// `id` ist die Hash-Quelle für die Farbe; `label` wird für Initials
// + aria-label genutzt. Kein Image-Slot im MVP — kommt wenn Apps
// echte Avatar-URLs haben.

import { type ReactNode, useMemo } from "react";
import { cn } from "../lib/cn";

export type AvatarSize = "sm" | "md" | "lg";

export type AvatarProps = {
  /** Stable Identifier — Hash-Quelle für die Background-Farbe. Üblich
   *  user.id; bei rein labelbasierten Avataren auch der label-String. */
  readonly id: string;
  /** Voller Name oder Email — Initials werden daraus extrahiert. */
  readonly label: string;
  readonly size?: AvatarSize;
  readonly testId?: string;
};

// Tailwind-Klassen pro Hue. Die Background-Lightness ist dezent (550-
// 600 für saturation), die Foreground-Lightness ist hell (50-100) für
// Kontrast. Passt zu beiden Modes weil die Tokens via CSS-vars greifen
// — aber: feste hex-Farben hier sind stabiler als token-mapping
// (Avatar-Farbe sollte deterministic sein, nicht theme-abhängig).
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
  sm: "size-5 text-[10px]",
  md: "size-6 text-[11px]",
  lg: "size-8 text-xs",
};

function hashCode(str: string): number {
  // djb2-Variante — schnell, deterministic, gut genug verteilt für
  // 8 Buckets. Crypto-Hash wäre Overkill für color-bucketing.
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
  // "Daniel Hennig" → "DH". "alice@example.com" → "A". Single-word
  // fällt auf erste 2 Buchstaben zurück ("Daniel" → "DA"). Alles
  // upper-case.
  const trimmed = label.trim();
  if (trimmed.length === 0) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return `${(parts[0]?.[0] ?? "").toUpperCase()}${(parts[1]?.[0] ?? "").toUpperCase()}`;
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export function Avatar({ id, label, size = "md", testId }: AvatarProps): ReactNode {
  const colorClass = useMemo(() => pickColor(id), [id]);
  const initials = useMemo(() => extractInitials(label), [label]);
  return (
    <span
      data-testid={testId}
      role="img"
      aria-label={label}
      className={cn(
        "inline-flex items-center justify-center rounded font-semibold uppercase select-none",
        SIZE_CLASSES[size],
        colorClass,
      )}
    >
      {initials}
    </span>
  );
}
