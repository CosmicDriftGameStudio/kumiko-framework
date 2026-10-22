import { useCallback, useRef, useState } from "react";
import type { BulkRowOutcome, DataTableBulkAction } from "../data-table-bulk-types.ts";
import type { ListRowViewModel } from "../headless/index.ts";

/** Parallel row writes of one run; more would crowd out the list's own requests. */
export const BULK_WRITE_CONCURRENCY = 4;

export type BulkRunResult = {
  readonly succeededIds: readonly string[];
  readonly failedIds: readonly string[];
  readonly skippedIds: readonly string[];
  /** Rows a cancel kept from starting. */
  readonly notStartedIds: readonly string[];
  readonly firstFailureMessage?: string;
};

type BulkRunAction = Pick<DataTableBulkAction, "appliesTo" | "writeRow">;

function failureOf(error: unknown): BulkRowOutcome {
  return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
}

/** One write per row, at most `concurrency` at a time. Cancel stops new writes; running ones finish. */
export async function runBulkWrites({
  rows,
  action,
  isCancelled,
  onRowSettled,
  concurrency = BULK_WRITE_CONCURRENCY,
}: {
  readonly rows: readonly ListRowViewModel[];
  readonly action: BulkRunAction;
  readonly isCancelled: () => boolean;
  readonly onRowSettled?: () => void;
  readonly concurrency?: number;
}): Promise<BulkRunResult> {
  const applicable = rows.filter((row) => action.appliesTo(row));
  const skippedIds = rows.filter((row) => !action.appliesTo(row)).map((row) => row.id);
  const succeededIds: string[] = [];
  const failedIds: string[] = [];
  let firstFailureMessage: string | undefined;
  let nextIndex = 0;

  async function drainQueue(): Promise<void> {
    while (nextIndex < applicable.length && !isCancelled()) {
      const row = applicable[nextIndex];
      nextIndex += 1;
      if (row === undefined) continue;
      const outcome = await action.writeRow(row).catch(failureOf);
      if (outcome.kind === "succeeded") {
        succeededIds.push(row.id);
      } else {
        failedIds.push(row.id);
        firstFailureMessage ??= outcome.message;
      }
      onRowSettled?.();
    }
  }

  const workerCount = Math.min(concurrency, applicable.length);
  await Promise.all(Array.from({ length: workerCount }, drainQueue));
  return {
    succeededIds,
    failedIds,
    skippedIds,
    notStartedIds: applicable.slice(nextIndex).map((row) => row.id),
    ...(firstFailureMessage !== undefined && { firstFailureMessage }),
  };
}

export type BulkRunState =
  | { readonly phase: "idle" }
  | {
      readonly phase: "running";
      readonly total: number;
      readonly settled: number;
      readonly cancelRequested: boolean;
    }
  | { readonly phase: "finished"; readonly result: BulkRunResult };

export type BulkRun = {
  readonly state: BulkRunState;
  readonly start: (
    action: BulkRunAction,
    rows: readonly ListRowViewModel[],
  ) => Promise<BulkRunResult>;
  readonly cancel: () => void;
  readonly dismissResult: () => void;
};

/** Execution model of a bulk run: progress counter, cancel and the final tally. */
export function useBulkRun(): BulkRun {
  const [state, setState] = useState<BulkRunState>({ phase: "idle" });
  const cancelledRef = useRef(false);

  const start = useCallback(async (action: BulkRunAction, rows: readonly ListRowViewModel[]) => {
    cancelledRef.current = false;
    const total = rows.filter((row) => action.appliesTo(row)).length;
    setState({ phase: "running", total, settled: 0, cancelRequested: false });
    const result = await runBulkWrites({
      rows,
      action,
      isCancelled: () => cancelledRef.current,
      onRowSettled: () =>
        setState((prev) =>
          prev.phase === "running" ? { ...prev, settled: prev.settled + 1 } : prev,
        ),
    });
    setState({ phase: "finished", result });
    return result;
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setState((prev) => (prev.phase === "running" ? { ...prev, cancelRequested: true } : prev));
  }, []);

  const dismissResult = useCallback(() => setState({ phase: "idle" }), []);

  return { state, start, cancel, dismissResult };
}
