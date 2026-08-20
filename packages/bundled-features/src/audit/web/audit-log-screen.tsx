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
import { Filter, RotateCcw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { TenantQueries } from "../../tenant/constants";
import { AUDIT_LOG_DETAIL_SCREEN_ID, AuditQueries, SYSTEM_ACTOR_ID } from "../constants";

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

type MemberRow = {
  readonly userId: string;
  readonly email: string | null;
  readonly displayName: string | null;
};

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
      readonly names: ReadonlyMap<string, string>;
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

  // Loaded once per screen lifetime, not per page — members rarely change
  // mid-session and refetching on every "older" click is wasted work.
  const membersRef = useRef<Promise<ReadonlyMap<string, string>> | null>(null);

  const load = useCallback(
    async (cursor?: string, overrideFilters?: Filters): Promise<void> => {
      setState({ kind: "loading" });
      const f = overrideFilters ?? filtersRef.current;
      membersRef.current ??= dispatcher
        .query<readonly MemberRow[]>(TenantQueries.members, {})
        .then((res) =>
          res.isSuccess
            ? new Map(res.data.map((m) => [m.userId, m.displayName ?? m.email ?? ""] as const))
            : new Map<string, string>(),
        );
      const [res, names] = await Promise.all([
        dispatcher.query<AuditResponse>(AuditQueries.list, {
          limit: 50,
          ...(cursor !== undefined && { before: cursor }),
          ...(f.eventType.trim() !== "" && { eventType: f.eventType.trim() }),
          ...(f.aggregateType.trim() !== "" && {
            aggregateType: f.aggregateType.trim(),
          }),
          ...(f.from !== "" && { from: toIsoStart(f.from) }),
          ...(f.to !== "" && { to: toIsoEnd(f.to) }),
        }),
        membersRef.current,
      ]);
      if (!res.isSuccess) {
        setState({ kind: "error", message: res.error.message });
        return;
      }
      setState({ kind: "ready", rows: res.data.rows, nextBefore: res.data.nextBefore, names });
    },
    [dispatcher],
  );

  // kumiko-lint-ignore no-raw-hooks Phase-3 conversion tracked in #2312
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
      <div className="flex flex-wrap items-end gap-4 px-6 pt-6">
        <div className="min-w-40 flex-1">
          <Field id="audit-filter-event" label={t("audit.log.filter.eventType")}>
            <Input
              kind="text"
              id="audit-filter-event"
              name="audit-filter-event"
              value={filters.eventType}
              onChange={(v: string) => setFilters((f) => ({ ...f, eventType: v }))}
            />
          </Field>
        </div>
        <div className="min-w-40 flex-1">
          <Field id="audit-filter-aggregate" label={t("audit.log.filter.aggregateType")}>
            <Input
              kind="text"
              id="audit-filter-aggregate"
              name="audit-filter-aggregate"
              value={filters.aggregateType}
              onChange={(v) => setFilters((f) => ({ ...f, aggregateType: v }))}
            />
          </Field>
        </div>
        <div className="min-w-40 flex-1">
          <Field id="audit-filter-from" label={t("audit.log.filter.from")}>
            <Input
              kind="date"
              id="audit-filter-from"
              name="audit-filter-from"
              value={filters.from}
              onChange={(v) => setFilters((f) => ({ ...f, from: v ?? "" }))}
            />
          </Field>
        </div>
        <div className="min-w-40 flex-1">
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
            <Filter className="h-4 w-4" />
            <span>{t("audit.log.filter.apply")}</span>
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
            <RotateCcw className="h-4 w-4" />
            <span>{t("audit.log.filter.reset")}</span>
          </Button>
        </div>
      </div>

      <DataTable
        testId="audit-log-table"
        columns={[
          { field: "when", label: t("audit.log.col.when"), type: "string", sortable: true },
          { field: "type", label: t("audit.log.col.type"), type: "string", sortable: true },
          { field: "actor", label: t("audit.log.col.actor"), type: "string", sortable: false },
        ]}
        sort={sort}
        onSortChange={setSort}
        rows={sortByAccessor(state.rows, sort, SORT_ACCESSORS).map((row) => ({
          id: row.id,
          values: {
            when: formatWhen(row.createdAt),
            type: row.type,
            actor:
              row.createdBy === SYSTEM_ACTOR_ID
                ? t("audit.log.actor.system")
                : (state.names.get(row.createdBy) ?? ""),
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
