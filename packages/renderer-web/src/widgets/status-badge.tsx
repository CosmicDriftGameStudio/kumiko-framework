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

// Fläche + Textfarbe pro Tone; `muted` läuft über die neutral-Tokens.
const TONE_PILL: Record<StatusTone, string> = {
  ok: "bg-status-ok-surface text-status-ok",
  warn: "bg-status-warn-surface text-status-warn",
  bad: "bg-status-bad-surface text-status-bad",
  critical: "bg-status-critical-surface text-status-critical",
  muted: "bg-status-neutral-surface text-status-neutral",
};

/** Pill-Badge mit Statuspunkt für Status-Werte. Caller mappt Domain-Werte → Tone
 *  (z.B. operational→ok, investigating→warn) und liefert das
 *  translated Label als children. */
export function StatusBadge({
  tone,
  children,
  className,
  testId,
}: {
  readonly tone: StatusTone;
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
