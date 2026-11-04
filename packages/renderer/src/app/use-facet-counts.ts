import { useCallback, useState } from "react";

/** Counts reported by the facet count bridges, keyed like the queries that asked for them. */
export function useFacetCounts(): {
  readonly facetCounts: Readonly<Record<string, number>>;
  readonly handleFacetCount: (key: string, count: number) => void;
} {
  const [facetCounts, setFacetCounts] = useState<Record<string, number>>({});
  const handleFacetCount = useCallback(
    (key: string, count: number) =>
      setFacetCounts((prev) => (prev[key] === count ? prev : { ...prev, [key]: count })),
    [],
  );
  return { facetCounts, handleFacetCount };
}
