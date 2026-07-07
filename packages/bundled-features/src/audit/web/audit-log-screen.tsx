// @runtime client
// Paginated tenant-scoped audit log (event store).

import { useDispatcher, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { FormScreenShell } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { AuditQueries } from "../constants";

type AuditRow = {
  readonly id: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly type: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly payload: Record<string, unknown>;
};

type AuditResponse = { readonly rows: readonly AuditRow[]; readonly nextBefore: string | null };

type Filters = {
  readonly eventType: string;
  readonly aggregateType: string;
  readonly from: string;
  readonly to: string;
};

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly rows: readonly AuditRow[];
      readonly nextBefore: string | null;
    };

const EMPTY_FILTERS: Filters = { eventType: "", aggregateType: "", from: "", to: "" };

export function AuditLogScreen(): ReactNode {
  const t = useTranslation();
  const { Banner, Button, Card, DataTable, Field, Heading, Input, Text } = usePrimitives();
  const dispatcher = useDispatcher();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [before, setBefore] = useState<string | undefined>(undefined);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string): Promise<void> => {
      setState({ kind: "loading" });
      const res = await dispatcher.query<AuditResponse>(AuditQueries.list, {
        limit: 50,
        ...(cursor !== undefined && { before: cursor }),
        ...(filters.eventType.trim() !== "" && { eventType: filters.eventType.trim() }),
        ...(filters.aggregateType.trim() !== "" && {
          aggregateType: filters.aggregateType.trim(),
        }),
        ...(filters.from !== "" && { from: toIsoStart(filters.from) }),
        ...(filters.to !== "" && { to: toIsoEnd(filters.to) }),
      });
      if (!res.isSuccess) {
        setState({ kind: "error", message: res.error.message });
        return;
      }
      setState({ kind: "ready", rows: res.data.rows, nextBefore: res.data.nextBefore });
    },
    [dispatcher, filters],
  );

  useEffect(() => {
    void load(before);
  }, [load, before]);

  const detailRow = state.kind === "ready" ? state.rows.find((r) => r.id === detailId) : undefined;

  if (state.kind === "loading") {
    return (
      <FormScreenShell testId="audit-log-screen">
        <Text variant="small">{t("audit.log.loading")}</Text>
      </FormScreenShell>
    );
  }

  if (state.kind === "error") {
    return (
      <FormScreenShell testId="audit-log-screen">
        <Banner variant="error">{state.message}</Banner>
      </FormScreenShell>
    );
  }

  return (
    <FormScreenShell testId="audit-log-screen" className="flex max-w-5xl flex-col gap-6">
      <Heading variant="page">{t("audit.log.title")}</Heading>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="audit-filter-event" label={t("audit.log.filter.eventType")}>
          <Input
            kind="text"
            id="audit-filter-event"
            name="audit-filter-event"
            value={filters.eventType}
            onChange={(v: string) => setFilters((f) => ({ ...f, eventType: v }))}
          />
        </Field>
        <Field id="audit-filter-aggregate" label={t("audit.log.filter.aggregateType")}>
          <Input
            kind="text"
            id="audit-filter-aggregate"
            name="audit-filter-aggregate"
            value={filters.aggregateType}
            onChange={(v) => setFilters((f) => ({ ...f, aggregateType: v }))}
          />
        </Field>
        <Field id="audit-filter-from" label={t("audit.log.filter.from")}>
          <Input
            kind="date"
            id="audit-filter-from"
            name="audit-filter-from"
            value={filters.from}
            onChange={(v) => setFilters((f) => ({ ...f, from: v ?? "" }))}
          />
        </Field>
        <Field id="audit-filter-to" label={t("audit.log.filter.to")}>
          <Input
            kind="date"
            id="audit-filter-to"
            name="audit-filter-to"
            value={filters.to}
            onChange={(v) => setFilters((f) => ({ ...f, to: v ?? "" }))}
          />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={() => {
            setBefore(undefined);
            void load(undefined);
          }}
          testId="audit-log-apply-filters"
        >
          {t("audit.log.filter.apply")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setFilters(EMPTY_FILTERS);
            setBefore(undefined);
          }}
          testId="audit-log-reset-filters"
        >
          {t("audit.log.filter.reset")}
        </Button>
      </div>

      <Card options={{ padded: false }}>
        <DataTable
          testId="audit-log-table"
          columns={[
            { field: "when", label: t("audit.log.col.when"), type: "string", sortable: false },
            { field: "type", label: t("audit.log.col.type"), type: "string", sortable: false },
            {
              field: "aggregate",
              label: t("audit.log.col.aggregate"),
              type: "string",
              sortable: false,
            },
            { field: "actor", label: t("audit.log.col.actor"), type: "string", sortable: false },
          ]}
          rows={state.rows.map((row) => ({
            id: row.id,
            values: {
              when: formatWhen(row.createdAt),
              type: row.type,
              aggregate: `${row.aggregateType} / ${row.aggregateId}`,
              actor: row.createdBy,
            },
          }))}
          rowActions={[
            {
              id: "details",
              label: t("audit.log.details"),
              style: "secondary",
              onTrigger: (row) => setDetailId(row.id),
            },
          ]}
          rowActionMode="inline"
          emptyState={<Text variant="small">{t("audit.log.empty")}</Text>}
        />
      </Card>

      {detailRow !== undefined && (
        <Card slots={{ title: t("audit.log.detail.title") }} options={{ padded: true }}>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">
            {JSON.stringify(detailRow.payload, null, 2)}
          </pre>
          <Button type="button" variant="secondary" onClick={() => setDetailId(null)}>
            {t("audit.log.detail.close")}
          </Button>
        </Card>
      )}

      <div className="flex gap-2">
        {before !== undefined && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setBefore(undefined)}
            testId="audit-log-newest"
          >
            {t("audit.log.newest")}
          </Button>
        )}
        {state.nextBefore !== null && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setBefore(state.nextBefore ?? undefined)}
            testId="audit-log-older"
          >
            {t("audit.log.older")}
          </Button>
        )}
      </div>
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

function toIsoStart(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toISOString();
}

function toIsoEnd(date: string): string {
  return new Date(`${date}T23:59:59.999Z`).toISOString();
}
