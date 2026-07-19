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

const TONE_PILL: Record<StatusTone, string> = {
  ok: "bg-status-ok/10 text-status-ok",
  warn: "bg-status-warn/10 text-status-warn",
  bad: "bg-status-bad/10 text-status-bad",
  critical: "bg-status-critical/15 text-status-critical",
  muted: "bg-muted text-muted-foreground",
};

/** Pill-Badge für Status-Werte. Caller mappt Domain-Werte → Tone
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
        "inline-block rounded-xl px-2.5 py-1 text-xs font-semibold",
        TONE_PILL[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
