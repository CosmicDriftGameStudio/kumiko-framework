// One invisible bridge per facet chip, mirroring ReferenceFacetBridges — the
// chip count varies per screen, so useQuery can't be called in a loop. Each
// bridge asks the list query for a single row plus `total`.
// ponytail: one extra list query per chip, refetched on every list
// invalidation; a server-side facet-count handler replaces this if it hurts.
import { type ReactNode, useEffect } from "react";
import { useQuery } from "../hooks/use-query.js";

type CountedRows = { readonly total?: number };

function FacetCountBridge({
  countKey,
  queryType,
  payload,
  onCount,
}: {
  readonly countKey: string;
  readonly queryType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly onCount: (key: string, count: number) => void;
}): ReactNode {
  const result = useQuery<CountedRows>(queryType, payload);
  const total = result.data?.total;
  useEffect(() => {
    if (total !== undefined) onCount(countKey, total);
  }, [total, countKey, onCount]);
  return null;
}

export type FacetCountQuery = {
  readonly key: string;
  readonly payload: Readonly<Record<string, unknown>>;
};

export function FacetCountBridges({
  queryType,
  queries,
  onCount,
}: {
  readonly queryType: string;
  readonly queries: readonly FacetCountQuery[];
  readonly onCount: (key: string, count: number) => void;
}): ReactNode {
  return (
    <>
      {queries.map((query) => (
        <FacetCountBridge
          key={query.key}
          countKey={query.key}
          queryType={queryType}
          payload={query.payload}
          onCount={onCount}
        />
      ))}
    </>
  );
}
