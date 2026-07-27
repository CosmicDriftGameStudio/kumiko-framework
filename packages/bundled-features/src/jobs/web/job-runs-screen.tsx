// @runtime client
// SystemAdmin job-run list + manual trigger panel.

import {
  type DataTableSort,
  formatWhen,
  sortByAccessor,
  useMutation,
  useNav,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useMemo, useState } from "react";
import { JOB_RUN_DETAIL_SCREEN_ID, JobHandlers, JobQueries } from "../constants";

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

type CatalogEntry = {
  readonly jobName: string;
  readonly perTenant: boolean;
  readonly payloadSchema: Record<string, unknown> | null;
};

type CatalogResponse = { readonly rows: readonly CatalogEntry[] };

type TriggerResult = { readonly jobName: string; readonly bullJobId: string };

const STATUS_FILTER_OPTIONS = [
  { value: "", labelKey: "jobs.runs.filter.all" },
  { value: "completed", labelKey: "jobs.runs.filter.completed" },
  { value: "failed", labelKey: "jobs.runs.filter.failed" },
  { value: "running", labelKey: "jobs.runs.filter.running" },
  { value: "queued", labelKey: "jobs.runs.filter.queued" },
] as const;

export function JobRunsScreen(): ReactNode {
  const t = useTranslation();
  const { Banner, Button, DataTable, Field, Form, Heading, Input, Text } = usePrimitives();
  const nav = useNav();
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const [jobName, setJobName] = useState("");
  const [payloadText, setPayloadText] = useState("{}");
  const [clientError, setClientError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const listPayload = useMemo(
    () => ({
      limit: 50,
      ...(statusFilter !== "" && {
        status: statusFilter as "queued" | "running" | "completed" | "failed",
      }),
    }),
    [statusFilter],
  );

  const listQuery = useQuery<ListResponse | null>(JobQueries.list, listPayload);
  const catalogQuery = useQuery<CatalogResponse | null>(JobQueries.catalog, {});
  const triggerMutation = useMutation<TriggerResult>(JobHandlers.trigger);

  const filterOptions = STATUS_FILTER_OPTIONS.map((opt) => ({
    value: opt.value,
    label: t(opt.labelKey),
  }));

  const catalogRows = catalogQuery.data?.rows ?? [];
  const selected = catalogRows.find((row) => row.jobName === jobName) ?? null;
  const jobOptions = catalogRows.map((row) => ({
    value: row.jobName,
    label: row.jobName,
  }));

  const schemaHint =
    selected?.payloadSchema !== undefined && selected.payloadSchema !== null
      ? JSON.stringify(selected.payloadSchema, null, 2)
      : null;

  const onTrigger = async (): Promise<void> => {
    setClientError(null);
    setSuccessMessage(null);
    if (jobName === "") return;

    let payload: Record<string, unknown> = {};
    const trimmed = payloadText.trim();
    if (trimmed !== "" && trimmed !== "{}") {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          setClientError(t("jobs.trigger.payload.invalidJson"));
          return;
        }
        payload = parsed as Record<string, unknown>;
      } catch {
        setClientError(t("jobs.trigger.payload.invalidJson"));
        return;
      }
    }

    const res = await triggerMutation.mutate({
      jobName,
      ...(Object.keys(payload).length > 0 ? { payload } : {}),
    });
    if (!res.isSuccess) {
      setClientError(res.error.message);
      return;
    }
    setSuccessMessage(t("jobs.trigger.success"));
    void listQuery.refetch();
  };

  const openDetail = (id: string): void =>
    nav.navigate({ screenId: JOB_RUN_DETAIL_SCREEN_ID, entityId: id });

  const rows = listQuery.data?.rows ?? [];
  const listLoading = listQuery.loading === true && listQuery.data === null;
  const submitting = triggerMutation.pending;

  return (
    <div className="flex flex-col gap-6 p-6" data-testid="job-runs-screen">
      <section className="flex flex-col gap-3" data-testid="job-trigger-panel">
        <Heading variant="section">{t("jobs.trigger.title")}</Heading>
        <Text variant="small">{t("jobs.trigger.explainer")}</Text>

        {catalogQuery.error !== null && (
          <Banner variant="error" testId="job-trigger-catalog-error">
            {catalogQuery.error.message}
          </Banner>
        )}

        {catalogQuery.error === null &&
        catalogRows.length === 0 &&
        catalogQuery.loading !== true ? (
          <Text variant="small" testId="job-trigger-empty">
            {t("jobs.trigger.empty")}
          </Text>
        ) : catalogQuery.error !== null ? null : (
          <Form
            testId="job-trigger-form"
            onSubmit={(e) => {
              e?.preventDefault();
              void onTrigger();
            }}
            actions={
              <Button
                type="submit"
                disabled={jobName === "" || submitting}
                loading={submitting}
                testId="job-trigger-submit"
              >
                {submitting ? t("jobs.trigger.submitting") : t("jobs.trigger.submit")}
              </Button>
            }
          >
            <Field id="job-trigger-name" label={t("jobs.trigger.job")} required>
              <Input
                kind="select"
                id="job-trigger-name"
                name="job-trigger-name"
                value={jobName}
                onChange={setJobName}
                options={jobOptions}
              />
            </Field>

            {selected?.perTenant === true && (
              <Text variant="small" testId="job-trigger-per-tenant">
                {t("jobs.trigger.perTenant")}
              </Text>
            )}

            {schemaHint !== null && (
              <Text variant="code" testId="job-trigger-schema-hint">
                {t("jobs.trigger.payload.hint")}: {schemaHint}
              </Text>
            )}

            <Field id="job-trigger-payload" label={t("jobs.trigger.payload")}>
              <Input
                kind="textarea"
                id="job-trigger-payload"
                name="job-trigger-payload"
                value={payloadText}
                onChange={setPayloadText}
              />
            </Field>

            {clientError !== null && (
              <Banner variant="error" testId="job-trigger-error">
                {clientError}
              </Banner>
            )}
            {successMessage !== null && (
              <Banner variant="info" testId="job-trigger-success">
                {successMessage}
              </Banner>
            )}
          </Form>
        )}
      </section>

      {listQuery.error !== null && (
        <Banner variant="error" testId="job-runs-list-error">
          {listQuery.error.message}
        </Banner>
      )}

      {listLoading ? (
        <Text variant="small">{t("jobs.runs.loading")}</Text>
      ) : listQuery.error !== null ? null : (
        <DataTable
          testId="job-runs-table"
          columns={[
            { field: "job", label: t("jobs.runs.col.job"), type: "string", sortable: true },
            { field: "status", label: t("jobs.runs.col.status"), type: "string", sortable: true },
            { field: "started", label: t("jobs.runs.col.started"), type: "string", sortable: true },
            {
              field: "duration",
              label: t("jobs.runs.col.duration"),
              type: "string",
              sortable: false,
            },
          ]}
          sort={sort}
          onSortChange={setSort}
          rows={sortByAccessor(rows, sort, SORT_ACCESSORS).map((row) => ({
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
      )}
    </div>
  );
}

// Client-sort over the loaded page (≤50 rows). startedAt is an ISO string, so
// lexicographic compare is chronological — no Date parsing needed.
const SORT_ACCESSORS: Record<string, (r: JobRunRow) => string | number> = {
  job: (r) => r.jobName,
  status: (r) => r.status,
  started: (r) => r.startedAt,
};
