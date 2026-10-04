// One invisible bridge per facet chip, mirroring ReferenceFacetBridges — the
// chip count varies per screen, so useQuery can't be called in a loop. Each
// bridge asks the list query for a single row plus `total`.
// ponytail: one extra list query per chip, refetched with the list (live
// events and `refreshNonce` bumps after writes); a server-side facet-count
// handler replaces this if it hurts.
import { type ReactNode, useEffect, useRef } from "react";
import { useQuery } from "../hooks/use-query.js";

type CountedRows = { readonly total?: number };

function FacetCountBridge({
  countKey,
  queryType,
  payload,
  onCount,
  refreshNonce,
}: {
  readonly countKey: string;
  readonly queryType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly onCount: (key: string, count: number) => void;
  readonly refreshNonce: number;
}): ReactNode {
  const result = useQuery<CountedRows>(queryType, payload, { live: true });
  const total = result.data?.total;
  useEffect(() => {
    if (total !== undefined) onCount(countKey, total);
  }, [total, countKey, onCount]);
  const { refetch } = result;
  const seenNonce = useRef(refreshNonce);
  useEffect(() => {
    // skip: the mount fetch already covers the nonce the bridge started with
    if (seenNonce.current === refreshNonce) return;
    seenNonce.current = refreshNonce;
    void refetch();
  }, [refreshNonce, refetch]);
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
  refreshNonce,
}: {
  readonly queryType: string;
  readonly queries: readonly FacetCountQuery[];
  readonly onCount: (key: string, count: number) => void;
  /** Bumped after a write; every bridge refetches its count. */
  readonly refreshNonce: number;
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
          refreshNonce={refreshNonce}
        />
      ))}
    </>
  );
}
