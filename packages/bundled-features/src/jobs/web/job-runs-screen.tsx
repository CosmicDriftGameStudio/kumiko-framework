// @runtime client
// SystemAdmin job-run list with link to detail screen.

import { useDispatcher, useNav, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { FormScreenShell } from "@cosmicdrift/kumiko-renderer-web";
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
  const { Banner, Card, DataTable, Field, Heading, Input, Text } = usePrimitives();
  const dispatcher = useDispatcher();
  const nav = useNav();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [statusFilter, setStatusFilter] = useState("");

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
      <FormScreenShell testId="job-runs-screen">
        <Text variant="small">{t("jobs.runs.loading")}</Text>
      </FormScreenShell>
    );
  }

  if (state.kind === "error") {
    return (
      <FormScreenShell testId="job-runs-screen">
        <Banner variant="error">{state.message}</Banner>
      </FormScreenShell>
    );
  }

  return (
    <FormScreenShell testId="job-runs-screen" className="flex max-w-5xl flex-col gap-6">
      <Heading variant="page">{t("jobs.runs.title")}</Heading>

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

      <Card options={{ padded: false }}>
        <DataTable
          testId="job-runs-table"
          columns={[
            { field: "job", label: t("jobs.runs.col.job"), type: "string", sortable: true },
            { field: "status", label: t("jobs.runs.col.status"), type: "string", sortable: true },
            {
              field: "started",
              label: t("jobs.runs.col.started"),
              type: "string",
              sortable: true,
            },
            {
              field: "duration",
              label: t("jobs.runs.col.duration"),
              type: "string",
              sortable: false,
            },
          ]}
          rows={state.rows.map((row) => ({
            id: row.id,
            values: {
              job: row.jobName,
              status: row.status,
              started: formatWhen(row.startedAt),
              duration: row.duration ?? "—",
            },
          }))}
          rowActions={[
            {
              id: "open",
              label: t("jobs.runs.open"),
              style: "secondary",
              onTrigger: (row) =>
                nav.navigate({ screenId: JOB_RUN_DETAIL_SCREEN_ID, entityId: row.id }),
            },
          ]}
          rowActionMode="inline"
          emptyState={<Text variant="small">{t("jobs.runs.empty")}</Text>}
        />
      </Card>
    </FormScreenShell>
  );
}

function formatWhen(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}
