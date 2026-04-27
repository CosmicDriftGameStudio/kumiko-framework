// Tier 2.7e-4: Renderer-Side Eagerload für Reference-Felder.
//
// Pro Reference-Spalte einer Liste wird einmal `<feature>:query:
// <refEntity>:list` (limit:200) gerufen, eine Map<uuid, displayValue>
// gebaut, und der Renderer nutzt sie als Cell-Display-Renderer.
//
// Strategy-Trade-offs:
//   - Server-side Drizzle-Joins wären effizienter (eine Query statt
//     N+1), würden aber die executor-API um lookupTables erweitern
//     müssen. Für das MVP geht der Renderer-Side-Pfad vor.
//   - Limit:200 ist eine harte UX-Grenze: bei mehr Entries in der
//     referenced Entity zeigen die letzten Rows nur noch UUIDs.
//     Searchable-Combobox (Tier 2.1c) + Server-Eagerload mit
//     ID-Whitelist heben das später auf.
//
// Dieser Hook ist call-stable: Lookup-Map wird durch useQuery's
// internen Cache shared zwischen List + Edit-Form für die gleiche
// Entity, Live-Updates kommen via SSE (use-query-live).

import { useMemo } from "react";
import { REFERENCE_LIST_LOOKUP_LIMIT } from "./reference-limits";
import { useQuery } from "./use-query";

export type ReferenceLookupMap = ReadonlyMap<string, string>;

/** Bulk-Lookup für eine einzelne Reference-Spalte. Liefert eine Map
 *  von UUID → Display-Value (aus labelField). Während die Query lädt,
 *  ist die Map leer; der Caller fällt dann auf den UUID-Fallback.
 *
 *  `featureName` ist hier das **target**-Feature (refFeature aus
 *  ViewModel), nicht das current Feature — Cross-Feature-Refs lookup
 *  laufen damit gegen `<refFeature>:query:<refEntity>:list`. */
export function useReferenceLookup(
  featureName: string,
  refEntity: string,
  labelField: string,
): { readonly map: ReferenceLookupMap; readonly loading: boolean } {
  const queryQn = `${featureName}:query:${refEntity}:list`;
  const result = useQuery<{ rows: ReadonlyArray<Record<string, unknown>> }>(queryQn, {
    limit: REFERENCE_LIST_LOOKUP_LIMIT,
  });
  const map = useMemo(() => {
    const out = new Map<string, string>();
    for (const row of result.data?.rows ?? []) {
      const id = row["id"];
      if (id === undefined || id === null) continue;
      const idStr = String(id);
      const label = row[labelField] ?? id;
      out.set(idStr, String(label));
    }
    return out;
  }, [result.data, labelField]);
  return { map, loading: result.loading };
}
