import type {
  DashboardPanelDefinition,
  DashboardScreenPanel,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { evalVisibleWhen, type UseQueryResult } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { PanelError, type ScreenParams, useDashboardQuery } from "./dashboard-shared.tsx";

type VisibilityQueryResult = UseQueryResult<Readonly<Record<string, unknown>>>;

export type VisibilityQueryResults = ReadonlyMap<string, VisibilityQueryResult>;

export const VisibilityQueryContext = createContext<VisibilityQueryResults>(new Map());

export type VisibilityGate = {
  readonly key: string;
  readonly query: string;
  readonly payload: Readonly<Record<string, unknown>>;
};

export const NO_GATE_PAYLOAD: Readonly<Record<string, unknown>> = {};

export function visibilityGate(
  query: string,
  payload: Readonly<Record<string, unknown>>,
): VisibilityGate {
  return { key: `${query}|${JSON.stringify(payload)}`, query, payload };
}

// Embedded screens carry no screen filter; in-grid panels pass the filter
// (unless ignoreScreenFilter, never for a stat-group) and the time range.
function panelVisibilityGate(
  panel: DashboardPanelDefinition,
  screenParams: ScreenParams,
): VisibilityGate | undefined {
  if (panel.kind === "custom" || panel.visibleWhen === undefined) return undefined;
  if (panel.kind === "screen") return visibilityGate(panel.visibleWhen.query, NO_GATE_PAYLOAD);
  const dropsFilter =
    panel.kind !== "stat-group" && panel.kind !== "text" && panel.ignoreScreenFilter === true;
  return visibilityGate(panel.visibleWhen.query, {
    ...(dropsFilter ? {} : screenParams.filterParams),
    ...screenParams.rangeParams,
    ...screenParams.recordParams,
  });
}

// One live query per distinct gate (query + payload), shared by every panel
// that gates on it — N panels on the same status query would otherwise each
// open their own request, SSE subscription and refetch per event. The queries
// run as keyed siblings of the grid so a changing gate count never changes the
// grid's position in the tree (which would remount every panel).
function VisibilityGateQuery({
  gate,
  onResult,
  onForget,
}: {
  readonly gate: VisibilityGate;
  readonly onResult: (key: string, result: VisibilityQueryResult) => void;
  readonly onForget: (key: string) => void;
}): null {
  const { data, error, loading, refetch } = useDashboardQuery<Readonly<Record<string, unknown>>>(
    gate.query,
    gate.payload,
  );
  const { key } = gate;
  useEffect(() => {
    onResult(key, { data, error, loading, refetch });
  }, [key, data, error, loading, refetch, onResult]);
  useEffect(() => () => onForget(key), [key, onForget]);
  return null;
}

export function VisibilityGateQueries({
  gates,
  onResult,
  onForget,
}: {
  readonly gates: readonly VisibilityGate[];
  readonly onResult: (key: string, result: VisibilityQueryResult) => void;
  readonly onForget: (key: string) => void;
}): ReactNode {
  return gates.map((gate) => (
    <VisibilityGateQuery key={gate.key} gate={gate} onResult={onResult} onForget={onForget} />
  ));
}

export function useVisibilityGateResults(): {
  readonly results: VisibilityQueryResults;
  readonly report: (key: string, result: VisibilityQueryResult) => void;
  readonly forget: (key: string) => void;
} {
  const [results, setResults] = useState<VisibilityQueryResults>(new Map());
  const report = useCallback((key: string, result: VisibilityQueryResult) => {
    setResults((prev) => new Map(prev).set(key, result));
  }, []);
  const forget = useCallback((key: string) => {
    setResults((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);
  return { results, report, forget };
}

const NOOP_REFETCH = async (): Promise<void> => {};

// A gate reports through an effect, so for its first commit (and after a payload change) no
// result exists yet; without a placeholder that reads as "hidden" and flashes the fallback.
function withPendingGates(
  results: VisibilityQueryResults,
  gateKeys: readonly string[],
): VisibilityQueryResults {
  if (gateKeys.every((key) => results.has(key))) return results;
  const merged = new Map(results);
  for (const key of gateKeys) {
    if (!merged.has(key)) {
      merged.set(key, { data: null, error: null, loading: true, refetch: NOOP_REFETCH });
    }
  }
  return merged;
}

export function distinctVisibilityGates(
  panels: readonly DashboardPanelDefinition[],
  screenParams: ScreenParams,
): VisibilityGate[] {
  const gates = new Map<string, VisibilityGate>();
  for (const panel of panels) {
    const gate = panelVisibilityGate(panel, screenParams);
    if (gate !== undefined) gates.set(gate.key, gate);
  }
  return [...gates.values()];
}

export function GatedGridCell({
  panel,
  screenParams,
  label,
  className,
  children,
}: {
  readonly panel: Exclude<DashboardPanelDefinition, DashboardScreenPanel>;
  readonly screenParams: ScreenParams;
  readonly label: string;
  readonly className: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const gate = panelVisibilityGate(panel, screenParams);
  const visibility = useContext(VisibilityQueryContext).get(gate?.key ?? "");
  const visibleWhen = panel.kind === "custom" ? undefined : panel.visibleWhen;
  if (visibleWhen !== undefined) {
    const verdict = evalVisibleWhen(visibleWhen, visibility);
    if (verdict === "error" && visibility?.error) {
      return (
        <div className={cn("min-w-0", className)} data-testid={`dashboard-panel-${panel.id}`}>
          <PanelError
            label={label}
            error={visibility.error}
            onRetry={() => void visibility.refetch()}
          />
        </div>
      );
    }
    // Loading renders nothing too: a skeleton that then vanishes flickers.
    if (verdict !== "visible") return null;
  }
  return <div className={cn("min-w-0", className)}>{children}</div>;
}

export function useDashboardVisibility(
  panels: readonly DashboardPanelDefinition[],
  screenParams: ScreenParams,
) {
  const visibilityGates = distinctVisibilityGates(panels, screenParams);
  const gateResults = useVisibilityGateResults();
  const gateKeysSignature = visibilityGates.map((gate) => gate.key).join("\n");
  const gateResultsWithPending = useMemo(
    () =>
      withPendingGates(
        gateResults.results,
        gateKeysSignature === "" ? [] : gateKeysSignature.split("\n"),
      ),
    [gateResults.results, gateKeysSignature],
  );
  return { visibilityGates, gateResults, gateResultsWithPending };
}
