import type {
  DashboardPanelVisibility,
  ToolbarAction,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { ToolbarActionButton } from "../components/render-list-toolbar-action.tsx";
import { type UseQueryResult, useQuery } from "../hooks/use-query.ts";
import { evalVisibleWhen } from "./visible-when.ts";

type GateResult = UseQueryResult<Readonly<Record<string, unknown>>>;

// Same query name, same answer: buttons gating on one query share a single live request.
function GateQuery({
  query,
  onResult,
  onForget,
}: {
  readonly query: string;
  readonly onResult: (query: string, result: GateResult) => void;
  readonly onForget: (query: string) => void;
}): null {
  const { data, error, loading, refetch } = useQuery<Readonly<Record<string, unknown>>>(
    query,
    {},
    { live: true },
  );
  useEffect(() => {
    onResult(query, { data, error, loading, refetch });
  }, [query, data, error, loading, refetch, onResult]);
  useEffect(() => () => onForget(query), [query, onForget]);
  return null;
}

function gatesById(
  toolbarActions: readonly ToolbarAction[] | undefined,
): ReadonlyMap<string, DashboardPanelVisibility> {
  const gates = new Map<string, DashboardPanelVisibility>();
  for (const action of toolbarActions ?? []) {
    if (action.visibleWhen !== undefined) gates.set(action.id, action.visibleWhen);
  }
  return gates;
}

// Fail-closed: a gated button shows only after its query answered with a match; while the
// query loads or after it failed it stays hidden.
export function useGatedToolbarActions(
  toolbarActions: readonly ToolbarAction[] | undefined,
  resolved: readonly ToolbarActionButton[] | undefined,
): {
  readonly actions: readonly ToolbarActionButton[] | undefined;
  readonly gateQueries: ReactNode;
} {
  const [results, setResults] = useState<ReadonlyMap<string, GateResult>>(new Map());
  const report = useCallback((query: string, result: GateResult) => {
    setResults((prev) => new Map(prev).set(query, result));
  }, []);
  const forget = useCallback((query: string) => {
    setResults((prev) => {
      if (!prev.has(query)) return prev;
      const next = new Map(prev);
      next.delete(query);
      return next;
    });
  }, []);

  const gates = useMemo(() => gatesById(toolbarActions), [toolbarActions]);
  const distinctQueries = useMemo(
    () => [...new Set([...gates.values()].map((gate) => gate.query))],
    [gates],
  );

  const actions = useMemo(() => {
    if (gates.size === 0) return resolved;
    const visible = resolved?.filter((action) => {
      const gate = gates.get(action.id);
      return gate === undefined || evalVisibleWhen(gate, results.get(gate.query)) === "visible";
    });
    return visible !== undefined && visible.length > 0 ? visible : undefined;
  }, [gates, resolved, results]);

  const gateQueries = distinctQueries.map((query) => (
    <GateQuery key={query} query={query} onResult={report} onForget={forget} />
  ));
  return { actions, gateQueries };
}
