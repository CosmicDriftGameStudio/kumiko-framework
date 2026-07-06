// @runtime client
// SystemAdmin job-run list with link to detail screen.

import { useDispatcher, useNav, useTranslation } from "@cosmicdrift/kumiko-renderer";
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

export function JobRunsScreen(): ReactNode {
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const nav = useNav();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [statusFilter, setStatusFilter] = useState<string>("");

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

  if (state.kind === "loading") return <p>{t("jobs.runs.loading")}</p>;
  if (state.kind === "error") return <p style={{ color: "#b91c1c" }}>{state.message}</p>;

  return (
    <div data-testid="job-runs-screen" className="p-6 flex flex-col gap-4 max-w-5xl">
      <h1 className="text-2xl font-semibold m-0">{t("jobs.runs.title")}</h1>
      <label className="flex items-center gap-2 text-sm w-fit">
        {t("jobs.runs.filter.status")}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded px-2 py-1"
          data-testid="job-runs-status-filter"
        >
          <option value="">{t("jobs.runs.filter.all")}</option>
          <option value="completed">completed</option>
          <option value="failed">failed</option>
          <option value="running">running</option>
          <option value="queued">queued</option>
        </select>
      </label>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">{t("jobs.runs.col.job")}</th>
            <th className="p-2">{t("jobs.runs.col.status")}</th>
            <th className="p-2">{t("jobs.runs.col.started")}</th>
            <th className="p-2">{t("jobs.runs.col.duration")}</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {state.rows.map((row) => (
            <tr key={row.id} className="border-b border-muted" data-run-id={row.id}>
              <td className="p-2">
                <code>{row.jobName}</code>
              </td>
              <td className="p-2">{row.status}</td>
              <td className="p-2">{formatWhen(row.startedAt)}</td>
              <td className="p-2">{row.duration ?? "—"}</td>
              <td className="p-2">
                <button
                  type="button"
                  className="text-primary underline text-xs"
                  data-testid={`job-run-open-${row.id}`}
                  onClick={() =>
                    nav.navigate({ screenId: JOB_RUN_DETAIL_SCREEN_ID, entityId: row.id })
                  }
                >
                  {t("jobs.runs.open")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {state.rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("jobs.runs.empty")}</p>
      )}
    </div>
  );
}

function formatWhen(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}
