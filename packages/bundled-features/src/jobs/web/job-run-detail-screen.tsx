// @runtime client
// Single job-run detail + logs. Route entityId = run uuid.

import { useDispatcher, useNav, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { FormScreenShell } from "@cosmicdrift/kumiko-renderer-web";
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
  const { Banner, Button, Card, Text } = usePrimitives();
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

  if (state.kind === "loading") {
    return (
      <FormScreenShell testId="job-run-detail-screen">
        <Text variant="small">{t("jobs.detail.loading")}</Text>
      </FormScreenShell>
    );
  }

  if (state.kind === "missing") {
    return (
      <FormScreenShell testId="job-run-detail-screen">
        <Banner variant="error">{t("jobs.detail.missing")}</Banner>
      </FormScreenShell>
    );
  }

  if (state.kind === "error") {
    return (
      <FormScreenShell testId="job-run-detail-screen">
        <Banner variant="error">{state.message}</Banner>
      </FormScreenShell>
    );
  }

  const { run } = state;

  return (
    <FormScreenShell testId="job-run-detail-screen" className="flex flex-col gap-6">
      <Card slots={{ title: run.jobName }}>
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="font-medium">{t("jobs.detail.field.status")}</dt>
            <dd data-testid="job-run-status">{run.status}</dd>
          </div>
          <div>
            <dt className="font-medium">{t("jobs.detail.field.started")}</dt>
            <dd data-testid="job-run-started">{formatWhen(run.startedAt)}</dd>
          </div>
          {run.finishedAt !== undefined && run.finishedAt !== null && (
            <div>
              <dt className="font-medium">{t("jobs.detail.field.finished")}</dt>
              <dd data-testid="job-run-finished">{formatWhen(run.finishedAt)}</dd>
            </div>
          )}
          {run.duration !== undefined && run.duration !== null && (
            <div>
              <dt className="font-medium">{t("jobs.detail.field.duration")}</dt>
              <dd data-testid="job-run-duration">{run.duration}</dd>
            </div>
          )}
          <div>
            <dt className="font-medium">{t("jobs.detail.field.id")}</dt>
            <dd>
              <Text variant="code">{run.id}</Text>
            </dd>
          </div>
          {run.error !== undefined && run.error !== null && run.error !== "" && (
            <div>
              <dt className="font-medium">{t("jobs.detail.field.error")}</dt>
              <dd>
                <Banner variant="error">{run.error}</Banner>
              </dd>
            </div>
          )}
        </dl>
      </Card>

      {run.status === "failed" && (
        <Button
          type="button"
          variant="primary"
          disabled={retrying}
          loading={retrying}
          onClick={() => void onRetry()}
          testId="job-run-retry"
        >
          {retrying ? t("jobs.detail.retrying") : t("jobs.detail.retry")}
        </Button>
      )}

      {actionError !== null && <Banner variant="error">{actionError}</Banner>}

      <Card slots={{ title: t("jobs.detail.logs") }}>
        {run.logs.length === 0 ? (
          <Text variant="small">{t("jobs.detail.logs.empty")}</Text>
        ) : (
          <ul className="flex flex-col gap-1 font-mono text-sm" data-testid="job-run-logs">
            {run.logs.map((log) => (
              <li key={`${log.timestamp}-${log.level}-${log.message}`}>
                <span className="text-muted-foreground">[{log.level}]</span> {log.message}
              </li>
            ))}
          </ul>
        )}
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
