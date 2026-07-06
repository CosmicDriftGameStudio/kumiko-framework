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
  { value: "", label: "all" },
  { value: "completed", label: "completed" },
  { value: "failed", label: "failed" },
  { value: "running", label: "running" },
  { value: "queued", label: "queued" },
] as const;

export function JobRunsScreen(): ReactNode {
  const t = useTranslation();
  const { Banner, Button, Card, Field, Heading, Input, Text } = usePrimitives();
  const dispatcher = useDispatcher();
  const nav = useNav();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [statusFilter, setStatusFilter] = useState("");

  const filterOptions = STATUS_FILTER_OPTIONS.map((opt) => ({
    value: opt.value,
    label: opt.value === "" ? t("jobs.runs.filter.all") : opt.label,
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
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-3">{t("jobs.runs.col.job")}</th>
              <th className="p-3">{t("jobs.runs.col.status")}</th>
              <th className="p-3">{t("jobs.runs.col.started")}</th>
              <th className="p-3">{t("jobs.runs.col.duration")}</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row) => (
              <tr key={row.id} className="border-b border-muted" data-run-id={row.id}>
                <td className="p-3">
                  <Text variant="code">{row.jobName}</Text>
                </td>
                <td className="p-3">{row.status}</td>
                <td className="p-3">{formatWhen(row.startedAt)}</td>
                <td className="p-3">{row.duration ?? "—"}</td>
                <td className="p-3">
                  <Button
                    type="button"
                    variant="secondary"
                    testId={`job-run-open-${row.id}`}
                    onClick={() =>
                      nav.navigate({ screenId: JOB_RUN_DETAIL_SCREEN_ID, entityId: row.id })
                    }
                  >
                    {t("jobs.runs.open")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {state.rows.length === 0 && <Text variant="small">{t("jobs.runs.empty")}</Text>}
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
