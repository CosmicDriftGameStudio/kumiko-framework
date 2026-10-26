import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ErrorNotice } from "../../app/error-reference.tsx";
import type { Translate } from "../../headless/index.ts";
import { type useNav, useQuery, useRecordActions } from "../../index.ts";
import { resolveRefreshIntervalMs } from "./dashboard-refresh.ts";
import { useFilterParams, useTimeRange } from "./dashboard-screen-controls.tsx";
import { type ScreenParams, useLoadedAt, useRefetchRegistry } from "./dashboard-shared.tsx";

type Nav = ReturnType<typeof useNav>;
type RecordRow = Readonly<Record<string, unknown>>;

export function useDashboardScreenParams(
  screen: DashboardScreenDefinition,
  translate: Translate,
  nav: Nav,
) {
  const recordBinding = screen.record;
  const recordId = recordBinding !== undefined ? (nav.searchParams[recordBinding.param] ?? "") : "";
  const recordMissing = recordBinding !== undefined && recordId === "";
  const recordPayloadKey = recordBinding?.payloadKey ?? recordBinding?.param;
  const recordParams: Readonly<Record<string, unknown>> =
    recordPayloadKey !== undefined && recordId !== "" ? { [recordPayloadKey]: recordId } : {};
  const recordQueryName = recordBinding?.query;

  const { params: filterParams, picker } = useFilterParams(screen, !recordMissing);
  const { params: rangeParams, control: rangeControl } = useTimeRange(screen, translate);
  const screenParams: ScreenParams = {
    filterParams,
    rangeParams,
    recordParams,
    ...(recordId !== "" && { recordId }),
  };
  const { loadedAtMs, reportLoaded } = useLoadedAt(screenParams);
  return {
    recordBinding,
    recordId,
    recordMissing,
    recordPayloadKey,
    recordParams,
    recordQueryName,
    picker,
    rangeControl,
    screenParams,
    loadedAtMs,
    reportLoaded,
  };
}

export function useDashboardRecord(
  screen: DashboardScreenDefinition,
  params: Pick<
    ReturnType<typeof useDashboardScreenParams>,
    "recordQueryName" | "recordParams" | "recordMissing"
  >,
) {
  const { recordQueryName, recordParams, recordMissing } = params;
  // The record query is not a panel query: it needs the interval before the
  // registry context below exists, and `refresh.field` reads from its own row.
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(() =>
    resolveRefreshIntervalMs(screen.refresh, null),
  );
  const recordQuery = useQuery<RecordRow>(recordQueryName ?? "", recordParams, {
    enabled: recordQueryName !== undefined && !recordMissing,
    live: true,
    ...(refreshIntervalMs !== undefined && { refetchIntervalMs: refreshIntervalMs }),
  });
  const { data: recordRow, refetch: refetchRecord } = recordQuery;
  useEffect(() => {
    setRefreshIntervalMs(resolveRefreshIntervalMs(screen.refresh, recordRow));
  }, [screen.refresh, recordRow]);

  const { register, refetchRegistered } = useRefetchRegistry();
  const queryRuntime = useMemo(
    () => ({ refreshIntervalMs, register }),
    [refreshIntervalMs, register],
  );
  const refetchAll = useCallback(async () => {
    await Promise.all([
      recordQueryName !== undefined ? refetchRecord() : Promise.resolve(),
      refetchRegistered(),
    ]);
  }, [recordQueryName, refetchRecord, refetchRegistered]);
  return { recordQuery, recordRow, refetchRecord, queryRuntime, refetchAll };
}

const NO_RECORD_ROW: RecordRow = {};

export function useDashboardHeaderActions(
  screen: DashboardScreenDefinition,
  params: Pick<
    ReturnType<typeof useDashboardScreenParams>,
    "recordPayloadKey" | "recordId" | "recordQueryName" | "recordMissing"
  >,
  record: Pick<ReturnType<typeof useDashboardRecord>, "recordRow" | "refetchAll">,
  translate: Translate,
) {
  const { recordPayloadKey, recordId, recordQueryName, recordMissing } = params;
  const [actionError, setActionError] = useState<ErrorNotice | null>(null);
  const idOnlyRow = useMemo(
    () => (recordPayloadKey !== undefined ? { id: recordId, [recordPayloadKey]: recordId } : null),
    [recordId, recordPayloadKey],
  );
  const actionRow = recordQueryName !== undefined ? record.recordRow : idOnlyRow;
  const headerActions = useRecordActions({
    actions: actionRow !== null && !recordMissing ? screen.actions : undefined,
    record: actionRow ?? NO_RECORD_ROW,
    recordId,
    translate,
    onWriteSuccess: record.refetchAll,
  });
  return { actionError, setActionError, headerActions };
}
