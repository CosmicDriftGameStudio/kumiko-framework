import type { ReactNode } from "react";
import { cn } from "../lib/cn";

// Semantische Status-Tones — eine Farb-Familie für Component-Status,
// Incident-Status, Severity, Job-Zustände. Farben kommen aus den
// --color-status-* Theme-Tokens (styles.css), Apps überschreiben zentral.
export type StatusTone = "ok" | "warn" | "bad" | "critical" | "muted";

export const STATUS_TONE_TEXT: Record<StatusTone, string> = {
  ok: "text-status-ok",
  warn: "text-status-warn",
  bad: "text-status-bad",
  critical: "text-status-critical",
  muted: "text-muted-foreground",
};

/** `accent` is a brand-colored call-out (e.g. "3 suggestions"), not a status —
 *  hence not part of `StatusTone`, which toasts and select options share. */
export type StatusBadgeTone = StatusTone | "accent";

// `muted` maps to the neutral tokens, not a status-* palette.
const TONE_PILL: Record<StatusBadgeTone, string> = {
  accent: "bg-primary/10 text-primary",
  ok: "bg-status-ok-surface text-status-ok",
  warn: "bg-status-warn-surface text-status-warn",
  bad: "bg-status-bad-surface text-status-bad",
  critical: "bg-status-critical-surface text-status-critical",
  muted: "bg-status-neutral-surface text-status-neutral",
};

/** Pill badge with a status dot. Caller maps domain values to a tone
 *  (e.g. operational→ok, investigating→warn) and passes the translated
 *  label as children. */
export function StatusBadge({
  tone,
  children,
  className,
  testId,
}: {
  readonly tone: StatusBadgeTone;
  readonly children: ReactNode;
  readonly className?: string;
  readonly testId?: string;
}): ReactNode {
  return (
    <span
      data-testid={testId}
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-medium",
        TONE_PILL[tone],
        className,
      )}
    >
      <span aria-hidden="true" data-status-dot className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
