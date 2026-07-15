// @runtime client
// Paginated tenant-scoped audit log (event store). Rows link to the
// audit-log-detail screen; the screen title lives in the shell breadcrumb.

import {
  type DataTableSort,
  formatWhen,
  sortByAccessor,
  useDispatcher,
  useNav,
  usePrimitives,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AUDIT_LOG_DETAIL_SCREEN_ID, AuditQueries } from "../constants";

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
  const { Banner, Button, DataTable, Field, Input, Text } = usePrimitives();
  const dispatcher = useDispatcher();
  const nav = useNav();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [before, setBefore] = useState<string | undefined>(undefined);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<DataTableSort | null>(null);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const load = useCallback(
    async (cursor?: string, overrideFilters?: Filters): Promise<void> => {
      setState({ kind: "loading" });
      const f = overrideFilters ?? filtersRef.current;
      const res = await dispatcher.query<AuditResponse>(AuditQueries.list, {
        limit: 50,
        ...(cursor !== undefined && { before: cursor }),
        ...(f.eventType.trim() !== "" && { eventType: f.eventType.trim() }),
        ...(f.aggregateType.trim() !== "" && {
          aggregateType: f.aggregateType.trim(),
        }),
        ...(f.from !== "" && { from: toIsoStart(f.from) }),
        ...(f.to !== "" && { to: toIsoEnd(f.to) }),
      });
      if (!res.isSuccess) {
        setState({ kind: "error", message: res.error.message });
        return;
      }
      setState({ kind: "ready", rows: res.data.rows, nextBefore: res.data.nextBefore });
    },
    [dispatcher],
  );

  useEffect(() => {
    void load(before);
  }, [load, before]);

  if (state.kind === "loading") {
    return (
      <div className="p-6" data-testid="audit-log-screen">
        <Text variant="small">{t("audit.log.loading")}</Text>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="p-6" data-testid="audit-log-screen">
        <Banner variant="error">{state.message}</Banner>
      </div>
    );
  }

  const openDetail = (id: string): void =>
    nav.navigate({ screenId: AUDIT_LOG_DETAIL_SCREEN_ID, entityId: id });

  return (
    <div className="w-full" data-testid="audit-log-screen">
      <div className="flex flex-col gap-4 px-6 pt-6">
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
              void load(undefined, EMPTY_FILTERS);
            }}
            testId="audit-log-reset-filters"
          >
            {t("audit.log.filter.reset")}
          </Button>
        </div>
      </div>

      <DataTable
        testId="audit-log-table"
        columns={[
          { field: "when", label: t("audit.log.col.when"), type: "string", sortable: true },
          { field: "type", label: t("audit.log.col.type"), type: "string", sortable: true },
          {
            field: "aggregate",
            label: t("audit.log.col.aggregate"),
            type: "string",
            sortable: false,
          },
          { field: "actor", label: t("audit.log.col.actor"), type: "string", sortable: false },
        ]}
        sort={sort}
        onSortChange={setSort}
        rows={sortByAccessor(state.rows, sort, SORT_ACCESSORS).map((row) => ({
          id: row.id,
          values: {
            when: formatWhen(row.createdAt),
            type: row.type,
            aggregate: `${row.aggregateType} / ${row.aggregateId}`,
            actor: row.createdBy,
          },
        }))}
        onRowClick={(row) => openDetail(row.id)}
        rowActions={[
          {
            id: "details",
            label: t("audit.log.details"),
            style: "secondary",
            onTrigger: (row) => openDetail(row.id),
          },
        ]}
        rowActionMode="inline"
        emptyState={<Text variant="small">{t("audit.log.empty")}</Text>}
      />

      <div className="flex gap-2 px-6 pb-6">
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
    </div>
  );
}

// Client-sort over the loaded page (≤50 rows). createdAt is an ISO string, so
// lexicographic compare is chronological. Cross-page order stays cursor-based.
const SORT_ACCESSORS: Record<string, (r: AuditRow) => string> = {
  when: (r) => r.createdAt,
  type: (r) => r.type,
};

function toIsoStart(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toISOString();
}

function toIsoEnd(date: string): string {
  return new Date(`${date}T23:59:59.999Z`).toISOString();
}
