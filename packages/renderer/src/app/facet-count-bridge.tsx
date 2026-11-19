// One invisible bridge per count request, because useQuery cannot run in a loop. Named filters
// ask for `total`, counted facet fields for one grouped answer.
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { useQuery } from "../hooks/use-query.ts";
import { type FacetValueCounts, facetValueCountsOf } from "./facet-value-counts.ts";

function useRefetchOnNonce(refetch: () => Promise<void>, refreshNonce: number): void {
  const seenNonce = useRef(refreshNonce);
  useEffect(() => {
    // skip: the mount fetch already covers the nonce the bridge started with
    if (seenNonce.current === refreshNonce) return;
    seenNonce.current = refreshNonce;
    void refetch();
  }, [refreshNonce, refetch]);
}

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
  useRefetchOnNonce(result.refetch, refreshNonce);
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

export type FacetValueCountQuery = {
  readonly field: string;
  readonly payload: Readonly<Record<string, unknown>>;
};

function FacetValueCountBridge({
  field,
  queryType,
  payload,
  onValueCounts,
  refreshNonce,
}: {
  readonly field: string;
  readonly queryType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly onValueCounts: (field: string, counts: FacetValueCounts | undefined) => void;
  readonly refreshNonce: number;
}): ReactNode {
  const result = useQuery<unknown>(queryType, payload, { live: true });
  const counts = useMemo(() => facetValueCountsOf(result.data), [result.data]);
  useEffect(() => onValueCounts(field, counts), [field, counts, onValueCounts]);
  useRefetchOnNonce(result.refetch, refreshNonce);
  return null;
}

export function FacetValueCountBridges({
  queryType,
  queries,
  onValueCounts,
  refreshNonce,
}: {
  readonly queryType: string;
  readonly queries: readonly FacetValueCountQuery[];
  readonly onValueCounts: (field: string, counts: FacetValueCounts | undefined) => void;
  /** Bumped after a write; every bridge refetches its counts. */
  readonly refreshNonce: number;
}): ReactNode {
  return (
    <>
      {queries.map((query) => (
        <FacetValueCountBridge
          key={query.field}
          field={query.field}
          queryType={queryType}
          payload={query.payload}
          onValueCounts={onValueCounts}
          refreshNonce={refreshNonce}
        />
      ))}
    </>
  );
}
