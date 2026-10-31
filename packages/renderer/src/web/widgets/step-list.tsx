import { type ReactNode, useState } from "react";
import { usePrimitives, useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { ProgressBar } from "./progress-bar.tsx";
import { StatusBadge, type StatusBadgeTone } from "./status-badge.tsx";
import { type StepAction, StepActionButton, type StepListItem, StepRow } from "./step-list-row.tsx";

export type {
  StepAction,
  StepListItem,
  StepSource,
  StepStatus,
  StepTag,
} from "./step-list-row.tsx";

export type StepListProps = {
  readonly title: string;
  /** Second line under the title, e.g. who completed the list and when. */
  readonly subtitle?: string;
  /** Badge next to the title, e.g. "Erledigt" for a finished list. */
  readonly status?: { readonly label: string; readonly tone: StatusBadgeTone };
  readonly steps: readonly StepListItem[];
  /** Footer row: a ghost action for the whole list next to the primary next-step action. */
  readonly footerActions?: readonly StepAction[];
  /** Show only the first n steps plus "und k weitere Schritte" (expands on click). */
  readonly collapsedAfter?: number;
  /** "ai" (default) = AiSurface background, "plain" = no background. */
  readonly surface?: "ai" | "plain";
  /** Stretch to the container height: steps scroll in the middle, the footer stays pinned at the bottom. */
  readonly fill?: boolean;
  /** "full" (default) = "x von y erledigt" plus bar, "count" = only the count, "none" = neither, e.g. when `status` already says the list is done. */
  readonly progress?: "full" | "count" | "none";
  readonly emptyContent?: ReactNode;
  readonly testId?: string;
};

/** Ordered plan of steps with status icons, progress header and per-step actions. */
export function StepList({
  title,
  subtitle,
  status,
  steps,
  footerActions,
  collapsedAfter,
  surface = "ai",
  fill = false,
  progress = "full",
  emptyContent,
  testId = "step-list",
}: StepListProps): ReactNode {
  const t = useTranslation();
  const { Button } = usePrimitives();
  const [expanded, setExpanded] = useState(false);

  const total = steps.filter((step) => step.status !== "rejected").length;
  const done = steps.filter((step) => step.status === "done").length;
  const hiddenCount =
    collapsedAfter !== undefined && !expanded ? Math.max(0, steps.length - collapsedAfter) : 0;
  const visibleSteps = hiddenCount > 0 ? steps.slice(0, collapsedAfter) : steps;
  const footer = footerActions ?? [];
  const leadingFooter = footer.filter((action) => action.variant === "ghost");
  const trailingFooter = footer.filter((action) => action.variant !== "ghost");

  return (
    <section
      aria-label={title}
      data-testid={testId}
      className={cn(
        "flex min-h-0 flex-col text-sm",
        fill && "h-full",
        surface === "ai" && "bg-ai-surface",
      )}
    >
      <StepListHeader
        title={title}
        subtitle={subtitle}
        status={status}
        progress={progress}
        done={done}
        total={total}
        testId={testId}
      />
      {steps.length === 0 ? (
        emptyContent
      ) : (
        <ol className="m-0 min-h-0 grow list-none overflow-y-auto p-0">
          {visibleSteps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
          {hiddenCount > 0 && (
            <li className="px-4 py-3">
              {/* Reads as a quiet note under the steps; it still expands them on click. */}
              <Button
                variant="link"
                size="sm"
                className="text-[13px] font-normal text-foreground-secondary hover:text-foreground"
                onClick={() => setExpanded(true)}
                testId={`${testId}-more`}
              >
                {t("kumiko.widget.step-list.moreSteps", { count: hiddenCount })}
              </Button>
            </li>
          )}
        </ol>
      )}
      {footer.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2.5">
          {leadingFooter.map((action) => (
            <StepActionButton key={action.id} action={action} />
          ))}
          <div className="grow" />
          {trailingFooter.map((action) => (
            <StepActionButton key={action.id} action={action} />
          ))}
        </div>
      )}
    </section>
  );
}

function StepListHeader({
  title,
  subtitle,
  status,
  progress,
  done,
  total,
  testId,
}: Pick<StepListProps, "title" | "subtitle" | "status"> & {
  readonly progress: NonNullable<StepListProps["progress"]>;
  readonly done: number;
  readonly total: number;
  readonly testId: string;
}): ReactNode {
  const t = useTranslation();
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-border px-4 pb-3 pt-3.5">
      <div className="flex items-baseline gap-2">
        <h3 className="m-0 grow text-[15px] font-semibold">{title}</h3>
        {status !== undefined && (
          <StatusBadge tone={status.tone} testId={`${testId}-status`}>
            {status.label}
          </StatusBadge>
        )}
        {progress !== "none" && (
          <span className="text-[13px] text-muted-foreground" data-testid={`${testId}-progress`}>
            {t("kumiko.widget.step-list.progress", { done, total })}
          </span>
        )}
      </div>
      {subtitle !== undefined && (
        <p className="m-0 text-[13px] text-foreground-secondary" data-testid={`${testId}-subtitle`}>
          {subtitle}
        </p>
      )}
      {progress === "full" && (
        <ProgressBar
          size="thin"
          value={total === 0 ? 0 : done / total}
          ariaLabel={t("kumiko.widget.step-list.progressLabel")}
        />
      )}
    </div>
  );
}
