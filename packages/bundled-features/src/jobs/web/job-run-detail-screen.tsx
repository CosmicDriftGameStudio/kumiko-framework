// @runtime client
// Single job-run detail + logs. Route entityId = run uuid.

import { useDispatcher, useNav, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { JOB_RUNS_SCREEN_ID, JobHandlers, JobQueries } from "../constants";

type LogRow = {
  readonly level: string;
  readonly message: string;
  readonly timestamp: string;
};

type JobRunDetail = {
  readonly id: string;
  readonly jobName: string;
  readonly status: string;
  readonly startedAt: string;
  readonly finishedAt?: string | null;
  readonly duration?: number | null;
  readonly error?: string | null;
  readonly logs: readonly LogRow[];
};

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly run: JobRunDetail };

export function JobRunDetailScreen(): ReactNode {
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const nav = useNav();
  const runId = nav.route?.entityId;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [retrying, setRetrying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (runId === undefined || runId === "") {
      setState({ kind: "missing" });
      return;
    }
    setState({ kind: "loading" });
    const res = await dispatcher.query<JobRunDetail | null>(JobQueries.details, { runId });
    if (!res.isSuccess) {
      setState({ kind: "error", message: res.error.message });
      return;
    }
    if (res.data === null) {
      setState({ kind: "missing" });
      return;
    }
    setState({ kind: "ready", run: res.data });
  }, [dispatcher, runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRetry = async (): Promise<void> => {
    if (runId === undefined || runId === "") return;
    setActionError(null);
    setRetrying(true);
    const res = await dispatcher.write(JobHandlers.retry, { runId });
    setRetrying(false);
    if (!res.isSuccess) {
      setActionError(res.error.message);
      return;
    }
    nav.navigate({ screenId: JOB_RUNS_SCREEN_ID });
  };

  if (state.kind === "loading") return <p>{t("jobs.detail.loading")}</p>;
  if (state.kind === "missing") return <p>{t("jobs.detail.missing")}</p>;
  if (state.kind === "error") return <p style={{ color: "#b91c1c" }}>{state.message}</p>;

  const { run } = state;

  return (
    <div data-testid="job-run-detail-screen" className="p-6 flex flex-col gap-4 max-w-3xl">
      <button
        type="button"
        className="text-sm text-primary w-fit"
        onClick={() => nav.navigate({ screenId: JOB_RUNS_SCREEN_ID })}
        data-testid="job-run-back"
      >
        {t("jobs.detail.back")}
      </button>
      <h1 className="text-2xl font-semibold m-0">{t("jobs.detail.title")}</h1>
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="font-medium">{t("jobs.detail.field.job")}</dt>
          <dd>
            <code>{run.jobName}</code>
          </dd>
        </div>
        <div>
          <dt className="font-medium">{t("jobs.detail.field.status")}</dt>
          <dd data-testid="job-run-status">{run.status}</dd>
        </div>
        <div>
          <dt className="font-medium">{t("jobs.detail.field.id")}</dt>
          <dd>
            <code className="text-xs">{run.id}</code>
          </dd>
        </div>
        {run.error !== undefined && run.error !== null && run.error !== "" && (
          <div>
            <dt className="font-medium">{t("jobs.detail.field.error")}</dt>
            <dd className="text-destructive">{run.error}</dd>
          </div>
        )}
      </dl>
      {run.status === "failed" && (
        <button
          type="button"
          disabled={retrying}
          className="bg-primary text-primary-foreground rounded px-4 py-2 text-sm w-fit"
          onClick={() => void onRetry()}
          data-testid="job-run-retry"
        >
          {retrying ? t("jobs.detail.retrying") : t("jobs.detail.retry")}
        </button>
      )}
      {actionError !== null && <p className="text-sm text-destructive">{actionError}</p>}
      <section>
        <h2 className="text-lg font-medium">{t("jobs.detail.logs")}</h2>
        {run.logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("jobs.detail.logs.empty")}</p>
        ) : (
          <ul className="text-sm font-mono flex flex-col gap-1 mt-2" data-testid="job-run-logs">
            {run.logs.map((log, i) => (
              <li key={`${log.timestamp}-${i}`}>
                <span className="text-muted-foreground">[{log.level}]</span> {log.message}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
