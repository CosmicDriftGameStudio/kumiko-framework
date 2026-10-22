import { MAX_BULK_SELECTION } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { DataTableBulkAction } from "../../../data-table-bulk-types.ts";
import type { Translate } from "../../../headless/index.ts";
import type { BulkRunResult, BulkRunState } from "../../../hooks/use-bulk-run.ts";
import { cn } from "../../lib/cn.ts";
import { DefaultBanner } from "../banner.tsx";
import { DefaultButton } from "../button.tsx";
import { DefaultDialog } from "../dialog.tsx";

const BAR_CLASS = "flex flex-wrap items-center gap-2 bg-muted/60 py-2 text-sm text-foreground";
// A scrollBody table has no frame of its own, so the bar spans it like the toolbar does.
const FLUSH_BAR_CLASS = "border-t px-6 max-md:px-3";
const FRAMED_BAR_CLASS = "rounded-lg border px-3";

function ResultBanner({
  result,
  actionLabel,
  t,
  onDismiss,
}: {
  readonly result: BulkRunResult;
  readonly actionLabel: string;
  readonly t: Translate;
  readonly onDismiss: () => void;
}): ReactNode {
  const tallies = [
    { key: "succeeded", text: "kumiko.list.bulk.result.succeeded", ids: result.succeededIds },
    { key: "failed", text: "kumiko.list.bulk.result.failed", ids: result.failedIds },
    { key: "skipped", text: "kumiko.list.bulk.result.skipped", ids: result.skippedIds },
    { key: "not-started", text: "kumiko.list.bulk.result.not-started", ids: result.notStartedIds },
  ] as const;
  return (
    <DefaultBanner
      variant={result.failedIds.length > 0 ? "warning" : "info"}
      title={t("kumiko.list.bulk.result.title", { action: actionLabel })}
      testId="bulk-result"
      actions={
        <DefaultButton
          variant="secondary"
          size="sm"
          onClick={onDismiss}
          testId="bulk-result-dismiss"
        >
          {t("kumiko.list.bulk.result.dismiss")}
        </DefaultButton>
      }
    >
      <ul className="m-0 flex list-none flex-wrap gap-x-4 p-0">
        {tallies
          .filter((tally) => tally.key === "succeeded" || tally.ids.length > 0)
          .map((tally) => (
            <li key={tally.key} data-testid={`bulk-result-${tally.key}`}>
              {t(tally.text, { count: tally.ids.length })}
            </li>
          ))}
      </ul>
      {result.firstFailureMessage !== undefined && (
        <p data-testid="bulk-result-error" className="m-0 mt-1 text-foreground-secondary">
          {result.firstFailureMessage}
        </p>
      )}
    </DefaultBanner>
  );
}

function RunProgress({
  state,
  t,
  onCancel,
  barClassName,
}: {
  readonly state: Extract<BulkRunState, { phase: "running" }>;
  readonly t: Translate;
  readonly onCancel: () => void;
  readonly barClassName: string;
}): ReactNode {
  return (
    <div data-testid="bulk-bar" data-phase="running" className={barClassName}>
      <span data-testid="bulk-progress" className="tabular-nums" aria-live="polite">
        {t("kumiko.list.bulk.progress", { settled: state.settled, total: state.total })}
      </span>
      <DefaultButton
        variant="secondary"
        size="sm"
        onClick={onCancel}
        disabled={state.cancelRequested}
        testId="bulk-cancel"
        className="ms-auto"
      >
        {t(state.cancelRequested ? "kumiko.list.bulk.cancelling" : "kumiko.list.bulk.cancel")}
      </DefaultButton>
    </div>
  );
}

export function BulkSelectionBar({
  flush,
  actions,
  selectedCount,
  isFull,
  runState,
  resultActionLabel,
  pendingAction,
  t,
  onRequest,
  onConfirm,
  onConfirmClose,
  onCancel,
  onClear,
  onDismissResult,
}: {
  readonly flush: boolean;
  readonly actions: readonly DataTableBulkAction[];
  readonly selectedCount: number;
  readonly isFull: boolean;
  readonly runState: BulkRunState;
  readonly resultActionLabel: string;
  readonly pendingAction: DataTableBulkAction | undefined;
  readonly t: Translate;
  readonly onRequest: (action: DataTableBulkAction) => void;
  readonly onConfirm: (action: DataTableBulkAction) => void;
  readonly onConfirmClose: () => void;
  readonly onCancel: () => void;
  readonly onClear: () => void;
  readonly onDismissResult: () => void;
}): ReactNode {
  const confirmText = pendingAction?.confirmText?.(selectedCount);
  // skip: nothing selected, no run and no result leaves no bar in the DOM
  if (runState.phase === "idle" && selectedCount === 0 && pendingAction === undefined) return null;
  const barClassName = cn(BAR_CLASS, flush ? FLUSH_BAR_CLASS : FRAMED_BAR_CLASS);
  return (
    <div className={flush ? "flex flex-col" : "flex flex-col gap-2"}>
      {runState.phase === "finished" && (
        <div className={flush ? "px-6 pb-2 max-md:px-3" : undefined}>
          <ResultBanner
            result={runState.result}
            actionLabel={resultActionLabel}
            t={t}
            onDismiss={onDismissResult}
          />
        </div>
      )}
      {runState.phase === "running" ? (
        <RunProgress state={runState} t={t} onCancel={onCancel} barClassName={barClassName} />
      ) : (
        selectedCount > 0 && (
          <div data-testid="bulk-bar" data-phase="idle" className={barClassName}>
            <span data-testid="bulk-selected-count" className="font-medium tabular-nums">
              {t("kumiko.list.bulk.selected", { count: selectedCount })}
            </span>
            {actions.map((action) => (
              <DefaultButton
                key={action.id}
                variant={action.style === "danger" ? "danger" : "secondary"}
                size="sm"
                onClick={() => onRequest(action)}
                testId={`bulk-action-${action.id}`}
                {...(action.icon !== undefined && { icon: action.icon })}
              >
                {action.label}
              </DefaultButton>
            ))}
            {isFull && (
              <span data-testid="bulk-limit" className="text-foreground-secondary">
                {t("kumiko.list.bulk.limit", { max: MAX_BULK_SELECTION })}
              </span>
            )}
            <DefaultButton
              variant="ghost"
              size="sm"
              onClick={onClear}
              testId="bulk-clear"
              className="ms-auto"
            >
              {t("kumiko.list.bulk.clear")}
            </DefaultButton>
          </div>
        )
      )}
      {pendingAction !== undefined && (
        <DefaultDialog
          open
          onOpenChange={(open) => {
            if (!open) onConfirmClose();
          }}
          title={pendingAction.label}
          {...(confirmText !== undefined && { description: confirmText })}
          confirmLabel={pendingAction.confirmLabel ?? pendingAction.label}
          variant={pendingAction.style === "danger" ? "danger" : "default"}
          // The run must not hold the dialog open: the bar shows its progress.
          onConfirm={() => onConfirm(pendingAction)}
          testId="bulk-confirm"
        />
      )}
    </div>
  );
}
