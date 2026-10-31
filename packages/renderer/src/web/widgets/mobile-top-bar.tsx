import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { StatusBadge, type StatusBadgeTone } from "./status-badge.tsx";

export type MobileTopBarProps = {
  /** Screen label, e.g. "Posteingang · 1 von 5 offen". */
  readonly label: string;
  /** Chevron button before the label; label is its aria-label. */
  readonly back?: { readonly label: string; readonly onClick: () => void };
  /** Chip before the actions, e.g. "KI an". */
  readonly status?: { readonly label: string; readonly tone: StatusBadgeTone };
  /** Trailing controls, e.g. an overflow menu trigger. */
  readonly actions?: ReactNode;
  readonly testId?: string;
};

/** Phone-only bar for focused screens: the shell header is hidden there, so the screen brings its own. */
export function MobileTopBar({
  label,
  back,
  status,
  actions,
  testId = "mobile-top-bar",
}: MobileTopBarProps): ReactNode {
  return (
    <div
      data-testid={testId}
      className="flex h-13 shrink-0 items-center gap-1 border-b border-border bg-card px-2 md:hidden"
    >
      {back !== undefined && (
        <button
          type="button"
          aria-label={back.label}
          data-testid={`${testId}-back`}
          onClick={back.onClick}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px] font-normal text-foreground-secondary",
          back === undefined && "pl-2",
        )}
      >
        {label}
      </span>
      {status !== undefined && (
        <StatusBadge tone={status.tone} testId={`${testId}-status`}>
          {status.label}
        </StatusBadge>
      )}
      {actions}
    </div>
  );
}
