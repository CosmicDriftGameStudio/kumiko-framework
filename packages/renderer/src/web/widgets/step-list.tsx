import { type ReactNode, useState } from "react";
import { usePrimitives, useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { ProgressBar } from "./progress-bar.tsx";
import { StatusBadge, type StatusBadgeTone } from "./status-badge.tsx";
import { useStepFold } from "./step-list-fit.ts";
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
  /** "always" (default) folds after `collapsedAfter`; "overflow" folds a `fill` list only when its steps do not fit its height, then shows as many as fit but at least `collapsedAfter`. */
  readonly collapseWhen?: "always" | "overflow";
  /** "ai" (default) = AiSurface background, "plain" = no background. */
  readonly surface?: "ai" | "plain";
  /** Stretch to the container height: steps scroll in the middle, the footer stays pinned at the bottom. */
  readonly fill?: boolean;
  /** "full" (default) = "x von y erledigt" plus bar, "count" = only the count, "none" = neither, e.g. when `status` already says the list is done. */
  readonly progress?: "full" | "count" | "none";
  readonly emptyContent?: ReactNode;
  /** On a phone the list reads as a card: the header sits inside the surface and the steps in a framed white box. */
  readonly phoneCard?: boolean;
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
  collapseWhen = "always",
  surface = "ai",
  fill = false,
  progress = "full",
  emptyContent,
  phoneCard = false,
  testId = "step-list",
}: StepListProps): ReactNode {
  const t = useTranslation();
  const { Button } = usePrimitives();
  const [expanded, setExpanded] = useState(false);

  const total = steps.filter((step) => step.status !== "rejected").length;
  const done = steps.filter((step) => step.status === "done").length;
  const fold = useStepFold({
    stepIds: steps.map((step) => step.id),
    collapsedAfter,
    foldsOnOverflow: fill && collapseWhen === "overflow",
    expanded,
  });
  const foldAfter = fold.foldAfter;
  const hiddenCount =
    foldAfter !== undefined && !expanded ? Math.max(0, steps.length - foldAfter) : 0;
  const visibleSteps = hiddenCount > 0 ? steps.slice(0, foldAfter) : steps;
  const footer = footerActions ?? [];
  const leadingFooter = footer.filter((action) => action.variant === "ghost");
  const trailingFooter = footer.filter((action) => action.variant !== "ghost");

  return (
    <section
      aria-label={title}
      data-testid={testId}
      className={cn(
        // Px on phones: an app may shrink its root font for desktop density, the phone reading size stays.
        "flex min-h-0 flex-col text-sm max-md:text-[14px]",
        fill && "h-full",
        surface === "ai" && "bg-ai-surface",
        phoneCard && "max-md:rounded-md max-md:p-3",
      )}
    >
      <StepListHeader
        title={title}
        subtitle={subtitle}
        status={status}
        progress={progress}
        done={done}
        total={total}
        phoneCard={phoneCard}
        testId={testId}
      />
      {steps.length === 0 ? (
        emptyContent
      ) : (
        <ol
          ref={fold.listRef}
          className={cn(
            "m-0 min-h-0 grow list-none overflow-y-auto p-0",
            phoneCard &&
              "max-md:rounded-md max-md:border max-md:border-border max-md:bg-card max-md:[&>li:last-child]:border-b-0 max-md:[&>li]:px-3 max-md:[&>li]:py-2.5",
          )}
        >
          {visibleSteps.map((step) => (
            <StepRow key={step.id} step={step} phoneCard={phoneCard} />
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
  phoneCard,
  testId,
}: Pick<StepListProps, "title" | "subtitle" | "status"> & {
  readonly phoneCard: boolean;
  readonly progress: NonNullable<StepListProps["progress"]>;
  readonly done: number;
  readonly total: number;
  readonly testId: string;
}): ReactNode {
  const t = useTranslation();
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-2 border-b border-border px-4 pb-3 pt-3.5",
        phoneCard && "max-md:border-b-0 max-md:px-0 max-md:pb-1.5 max-md:pt-0",
      )}
    >
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
        <div className={cn(phoneCard && "max-md:hidden")}>
          <ProgressBar
            size="thin"
            value={total === 0 ? 0 : done / total}
            ariaLabel={t("kumiko.widget.step-list.progressLabel")}
          />
        </div>
      )}
    </div>
  );
}
