import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { useIsBelowSmViewport } from "../primitives/use-narrow-viewport.ts";
import {
  Sparkline,
  type StatDelta,
  type StatLink,
  StatLinkFrame,
  type StatTone,
  TONE_VALUE,
} from "./stat.tsx";

type StatBoxCellProps = {
  readonly label: string;
  /** Replaces `label` in the one-line phone variant. */
  readonly narrowLabel?: string;
  readonly value: string;
  readonly sub?: string;
  readonly tone?: StatTone;
  readonly icon?: ReactNode;
  readonly delta?: StatDelta;
  readonly spark?: readonly number[];
  readonly testId?: string;
  readonly link?: StatLink;
};

/** Cell of a titled stat strip. From `sm` a box: the number large on the left, label bold and
 *  sub line small beside it. Below `sm` plain text "<number> <label>" that joins the strip's single line. */
export function StatBoxCell({
  label,
  narrowLabel,
  value,
  sub,
  tone = "default",
  icon,
  delta,
  spark,
  testId,
  link,
}: StatBoxCellProps): ReactNode {
  const belowSm = useIsBelowSmViewport();
  return (
    <StatLinkFrame link={link} testId={testId}>
      {belowSm ? (
        <span data-testid={testId} className="whitespace-nowrap text-sm">
          <span className="font-semibold tabular-nums text-foreground">{value}</span>{" "}
          <span className="text-foreground">{narrowLabel ?? label}</span>
        </span>
      ) : (
        <div
          data-testid={testId}
          className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-background px-3 py-2"
        >
          {icon}
          <span
            className={cn("text-2xl font-semibold leading-none tabular-nums", TONE_VALUE[tone])}
          >
            {value}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold text-foreground">{label}</span>
            {sub !== undefined && (
              <span className="truncate text-xs text-muted-foreground">{sub}</span>
            )}
          </div>
          {delta !== undefined && (
            <span className="whitespace-nowrap text-xs font-medium tabular-nums text-muted-foreground">
              {delta.direction === "up" ? "↑" : "↓"}
              {delta.value}
            </span>
          )}
          {spark !== undefined && (
            <Sparkline points={spark} className={cn("h-6 w-16 shrink-0", TONE_VALUE[tone])} />
          )}
        </div>
      )}
    </StatLinkFrame>
  );
}
