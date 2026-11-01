import { type ReactNode, type RefObject, useState } from "react";
import { pluralKey } from "../../headless/plural-key.ts";
import { usePrimitives, useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { Checkbox } from "../ui/checkbox.tsx";
import { ProgressBar } from "./progress-bar.tsx";
import { StatusBadge, type StatusBadgeTone } from "./status-badge.tsx";
import { useStepFold } from "./step-list-fit.ts";
import {
  type StepAction,
  StepActionButton,
  type StepListItem,
  StepRow,
  type StepRowSelection,
} from "./step-list-row.tsx";
import {
  resolveStepSelection,
  type StepSelectionSummary,
  toggleAllStepSelection,
  toggleStepSelection,
} from "./step-list-selection.ts";

export type {
  StepAction,
  StepListItem,
  StepSelectability,
  StepSource,
  StepStatus,
  StepTag,
} from "./step-list-row.tsx";

export type StepSelectionAction = {
  readonly id: string;
  /** Without a number: the list appends " (n)" with the effective selection size. */
  readonly label: string;
  /** Receives the effective selection in list order, prerequisites included. */
  readonly onClick: (stepIds: readonly string[]) => void;
  readonly variant?: "primary" | "secondary" | "ghost";
  readonly disabled?: boolean;
  readonly pending?: boolean;
};

export type StepListSelection = {
  /** Explicitly chosen step ids (controlled); prerequisites are added on top. */
  readonly selectedIds: readonly string[];
  readonly onSelectionChange: (selectedIds: readonly string[]) => void;
  /** Replace `footerActions` while at least one step is selected. */
  readonly actions: readonly StepSelectionAction[];
};

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
  /** Adds a checkbox per selectable step, a select-all row and selection footer actions. */
  readonly selection?: StepListSelection;
  /** On a phone the list reads as a card: the header sits inside the surface and the steps in a framed white box. */
  readonly phoneCard?: boolean;
  readonly testId?: string;
};

function selectionFooterActions(
  selection: StepListSelection,
  summary: StepSelectionSummary,
  t: ReturnType<typeof useTranslation>,
): readonly StepAction[] {
  return selection.actions.map((action) => ({
    id: action.id,
    label: t("kumiko.widget.step-list.actionWithCount", {
      label: action.label,
      count: summary.selectedCount,
    }),
    onClick: () => action.onClick(summary.effectiveIds),
    variant: action.variant,
    disabled: action.disabled,
    pending: action.pending,
  }));
}

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
  selection,
  phoneCard = false,
  testId = "step-list",
}: StepListProps): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const { total, done } = countProgress(steps);
  const { visibleSteps, hiddenCount, listRef } = useStepFolding({
    steps,
    collapsedAfter,
    foldsOnOverflow: fill && collapseWhen === "overflow",
    expanded,
  });
  const model = useSelectionModel(steps, selection, footerActions);
  const { summary, footer, selectionFooterActive } = model;

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
      <SelectAllSection
        steps={steps}
        selection={selection}
        summary={summary}
        phoneCard={phoneCard}
      />
      {steps.length === 0 ? (
        emptyContent
      ) : (
        <StepListRows
          steps={steps}
          visibleSteps={visibleSteps}
          hiddenCount={hiddenCount}
          listRef={listRef}
          selection={selection}
          summary={summary}
          phoneCard={phoneCard}
          onExpand={() => setExpanded(true)}
          testId={testId}
        />
      )}
      <StepListFooter footer={footer} selectionActive={selectionFooterActive} />
    </section>
  );
}

function countProgress(steps: readonly StepListItem[]): { total: number; done: number } {
  return {
    total: steps.filter((step) => step.status !== "rejected").length,
    done: steps.filter((step) => step.status === "done").length,
  };
}

function useStepFolding(input: {
  readonly steps: readonly StepListItem[];
  readonly collapsedAfter: number | undefined;
  readonly foldsOnOverflow: boolean;
  readonly expanded: boolean;
}): {
  visibleSteps: readonly StepListItem[];
  hiddenCount: number;
  listRef: RefObject<HTMLOListElement | null>;
} {
  const { steps, collapsedAfter, foldsOnOverflow, expanded } = input;
  const fold = useStepFold({
    stepIds: steps.map((step) => step.id),
    collapsedAfter,
    foldsOnOverflow,
    expanded,
  });
  const foldAfter = fold.foldAfter;
  const hiddenCount =
    foldAfter !== undefined && !expanded ? Math.max(0, steps.length - foldAfter) : 0;
  const visibleSteps = hiddenCount > 0 ? steps.slice(0, foldAfter) : steps;
  return { visibleSteps, hiddenCount, listRef: fold.listRef };
}

function useSelectionModel(
  steps: readonly StepListItem[],
  selection: StepListSelection | undefined,
  footerActions: readonly StepAction[] | undefined,
): {
  summary: StepSelectionSummary | undefined;
  footer: readonly StepAction[];
  selectionFooterActive: boolean;
} {
  const t = useTranslation();
  const summary =
    selection === undefined ? undefined : resolveStepSelection(steps, selection.selectedIds);
  if (selection !== undefined && summary !== undefined && summary.selectedCount > 0) {
    return {
      summary,
      footer: selectionFooterActions(selection, summary, t),
      selectionFooterActive: true,
    };
  }
  return { summary, footer: footerActions ?? [], selectionFooterActive: false };
}

function SelectAllSection({
  steps,
  selection,
  summary,
  phoneCard,
}: {
  readonly steps: readonly StepListItem[];
  readonly selection: StepListSelection | undefined;
  readonly summary: StepSelectionSummary | undefined;
  readonly phoneCard: boolean;
}): ReactNode {
  if (selection === undefined || summary === undefined || steps.length === 0) return null;
  return (
    <SelectAllRow
      summary={summary}
      phoneCard={phoneCard}
      onToggle={() =>
        selection.onSelectionChange(toggleAllStepSelection(steps, selection.selectedIds))
      }
    />
  );
}

function rowSelectionFor(
  step: StepListItem,
  steps: readonly StepListItem[],
  selection: StepListSelection | undefined,
  summary: StepSelectionSummary | undefined,
): StepRowSelection | undefined {
  if (selection === undefined || summary === undefined) return undefined;
  return {
    state: summary.states.get(step.id) ?? { kind: "none" },
    onToggle: () =>
      selection.onSelectionChange(toggleStepSelection(steps, selection.selectedIds, step.id)),
  };
}

function StepListRows({
  steps,
  visibleSteps,
  hiddenCount,
  listRef,
  selection,
  summary,
  phoneCard,
  onExpand,
  testId,
}: {
  readonly steps: readonly StepListItem[];
  readonly visibleSteps: readonly StepListItem[];
  readonly hiddenCount: number;
  readonly listRef: RefObject<HTMLOListElement | null>;
  readonly selection: StepListSelection | undefined;
  readonly summary: StepSelectionSummary | undefined;
  readonly phoneCard: boolean;
  readonly onExpand: () => void;
  readonly testId: string;
}): ReactNode {
  const t = useTranslation();
  const { Button } = usePrimitives();
  return (
    <ol
      ref={listRef}
      className={cn(
        "m-0 min-h-0 grow list-none overflow-y-auto p-0",
        phoneCard &&
          "max-md:rounded-md max-md:border max-md:border-border max-md:bg-card max-md:[&>li:last-child]:border-b-0 max-md:[&>li]:px-3 max-md:[&>li]:py-2.5",
        selection !== undefined && phoneCard && "max-md:rounded-t-none",
      )}
    >
      {visibleSteps.map((step) => {
        const rowSelection = rowSelectionFor(step, steps, selection, summary);
        return (
          <StepRow
            key={step.id}
            step={step}
            phoneCard={phoneCard}
            {...(rowSelection !== undefined && { selection: rowSelection })}
          />
        );
      })}
      {hiddenCount > 0 && (
        <li className="px-4 py-3">
          {/* Reads as a quiet note under the steps; it still expands them on click. */}
          <Button
            variant="link"
            size="sm"
            className="text-[13px] font-normal text-foreground-secondary hover:text-foreground"
            onClick={onExpand}
            testId={`${testId}-more`}
          >
            {t("kumiko.widget.step-list.moreSteps", { count: hiddenCount })}
          </Button>
        </li>
      )}
    </ol>
  );
}

function StepListFooter({
  footer,
  selectionActive,
}: {
  readonly footer: readonly StepAction[];
  readonly selectionActive: boolean;
}): ReactNode {
  if (footer.length === 0) return null;
  const leading = footer.filter((action) => action.variant === "ghost");
  const trailing = footer.filter((action) => action.variant !== "ghost");
  const phoneHeight = selectionActive ? "max-md:h-11" : undefined;
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2.5">
      {leading.map((action) => (
        <StepActionButton key={action.id} action={action} className={phoneHeight} />
      ))}
      <div className={cn("grow", selectionActive && "max-md:hidden")} />
      {trailing.map((action) => (
        <StepActionButton
          key={action.id}
          action={action}
          className={cn(phoneHeight, selectionActive && "max-md:grow max-md:justify-center")}
        />
      ))}
    </div>
  );
}

function SelectAllRow({
  summary,
  phoneCard,
  onToggle,
}: {
  readonly summary: StepSelectionSummary;
  readonly phoneCard: boolean;
  readonly onToggle: () => void;
}): ReactNode {
  const t = useTranslation();
  const countText =
    summary.selectedCount === 0
      ? t("kumiko.widget.step-list.selectionNone")
      : t(pluralKey("kumiko.widget.step-list.selectionCount", summary.selectedCount), {
          count: summary.selectedCount,
        });
  const missingText =
    summary.missingInputCount > 0
      ? `, ${t(
          pluralKey("kumiko.widget.step-list.selectionMissingInput", summary.missingInputCount),
          {
            count: summary.missingInputCount,
          },
        )}`
      : "";
  const checked =
    summary.allState === "all" ? true : summary.allState === "some" ? "indeterminate" : false;
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2.5 border-b border-border bg-card/60 px-4 py-2",
        phoneCard &&
          "max-md:rounded-t-md max-md:border max-md:border-b-0 max-md:bg-card max-md:px-3",
      )}
      data-testid="step-list-select-all"
    >
      <Checkbox
        aria-label={t("kumiko.widget.step-list.selectAll")}
        checked={checked}
        disabled={!summary.hasSelectableSteps}
        onCheckedChange={onToggle}
      />
      <span className="text-[13px] font-medium">{t("kumiko.widget.step-list.selectAll")}</span>
      <span className="grow text-right text-[13px] text-muted-foreground">
        {countText}
        {missingText}
      </span>
    </div>
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
