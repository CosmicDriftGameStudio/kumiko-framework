// @runtime client
// SystemAdmin job-run list with link to detail screen.

import {
  type DataTableSort,
  useDispatcher,
  useNav,
  usePrimitives,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { JOB_RUN_DETAIL_SCREEN_ID, JobQueries } from "../constants";

type JobRunRow = {
  readonly id: string;
  readonly jobName: string;
  readonly status: string;
  readonly startedAt: string;
  readonly finishedAt?: string | null;
  readonly duration?: number | null;
  readonly error?: string | null;
};

type ListResponse = { readonly rows: readonly JobRunRow[] };

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly rows: readonly JobRunRow[] };

const STATUS_FILTER_OPTIONS = [
  { value: "", labelKey: "jobs.runs.filter.all" },
  { value: "completed", labelKey: "jobs.runs.filter.completed" },
  { value: "failed", labelKey: "jobs.runs.filter.failed" },
  { value: "running", labelKey: "jobs.runs.filter.running" },
  { value: "queued", labelKey: "jobs.runs.filter.queued" },
] as const;

export function JobRunsScreen(): ReactNode {
  const t = useTranslation();
  const { Banner, DataTable, Field, Input, Text } = usePrimitives();
  const dispatcher = useDispatcher();
  const nav = useNav();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState<DataTableSort | null>(null);

  const filterOptions = STATUS_FILTER_OPTIONS.map((opt) => ({
    value: opt.value,
    label: t(opt.labelKey),
  }));

  const refresh = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    const res = await dispatcher.query<ListResponse>(JobQueries.list, {
      limit: 50,
      ...(statusFilter !== "" && {
        status: statusFilter as "queued" | "running" | "completed" | "failed",
      }),
    });
    if (!res.isSuccess) {
      setState({ kind: "error", message: res.error.message });
      return;
    }
    setState({ kind: "ready", rows: res.data.rows });
  }, [dispatcher, statusFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state.kind === "loading") {
    return (
      <div className="p-6" data-testid="job-runs-screen">
        <Text variant="small">{t("jobs.runs.loading")}</Text>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="p-6" data-testid="job-runs-screen">
        <Banner variant="error">{state.message}</Banner>
      </div>
    );
  }

  const openDetail = (id: string): void =>
    nav.navigate({ screenId: JOB_RUN_DETAIL_SCREEN_ID, entityId: id });

  return (
    <DataTable
      testId="job-runs-table"
      columns={[
        { field: "job", label: t("jobs.runs.col.job"), type: "string", sortable: true },
        { field: "status", label: t("jobs.runs.col.status"), type: "string", sortable: true },
        { field: "started", label: t("jobs.runs.col.started"), type: "string", sortable: true },
        { field: "duration", label: t("jobs.runs.col.duration"), type: "string", sortable: false },
      ]}
      sort={sort}
      onSortChange={setSort}
      rows={sortJobRuns(state.rows, sort).map((row) => ({
        id: row.id,
        values: {
          job: row.jobName,
          status: row.status,
          started: formatWhen(row.startedAt),
          duration: row.duration ?? "—",
        },
      }))}
      onRowClick={(row) => openDetail(row.id)}
      toolbarStart={
        <Field id="job-runs-status-filter" label={t("jobs.runs.filter.status")}>
          <Input
            kind="select"
            id="job-runs-status-filter"
            name="job-runs-status-filter"
            value={statusFilter}
            onChange={setStatusFilter}
            options={filterOptions}
          />
        </Field>
      }
      rowActions={[
        {
          id: "open",
          label: t("jobs.runs.open"),
          style: "secondary",
          onTrigger: (row) => openDetail(row.id),
        },
      ]}
      rowActionMode="inline"
      emptyState={<Text variant="small">{t("jobs.runs.empty")}</Text>}
    />
  );
}

// Client-sort over the loaded page (≤50 rows). startedAt is an ISO string, so
// lexicographic compare is chronological — no Date parsing needed.
const SORT_ACCESSORS: Record<string, (r: JobRunRow) => string | number> = {
  job: (r) => r.jobName,
  status: (r) => r.status,
  started: (r) => r.startedAt,
};

function sortJobRuns(rows: readonly JobRunRow[], sort: DataTableSort | null): readonly JobRunRow[] {
  if (sort === null) return rows;
  const accessor = SORT_ACCESSORS[sort.field];
  if (accessor === undefined) return rows;
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    return av < bv ? -factor : av > bv ? factor : 0;
  });
}

function formatWhen(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}
