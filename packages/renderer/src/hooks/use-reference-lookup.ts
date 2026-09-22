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

import {
  REFERENCE_LOOKUP_SOURCES,
  SYSTEM_REFERENCE_LABELS,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { useMemo } from "react";
import { toKebab } from "../app/qn";
import { useTranslation } from "../i18n";
import { REFERENCE_LIST_LOOKUP_LIMIT } from "./reference-limits";
import { useQuery } from "./use-query";

export type ReferenceLookupMap = ReadonlyMap<string, string>;

/** Where a reference target's label rows come from: the central override for
 *  that `feature:entity` if one exists, else the entity-convention list
 *  handler plus the caller's own label field. */
export function referenceLookupSource(
  refFeature: string,
  refEntity: string,
  labelField: string,
): { readonly queryQn: string; readonly labelKey: string } {
  const override = REFERENCE_LOOKUP_SOURCES[`${refFeature}:${refEntity}`];
  if (override !== undefined) return override;
  return {
    queryQn: `${toKebab(refFeature)}:query:${toKebab(refEntity)}:list`,
    labelKey: labelField,
  };
}

/** Empty while the query loads (or fails), so callers fall back to the raw id.
 *  `featureName` is the reference's target feature, not the screen's. */
export function useReferenceLookup(
  featureName: string,
  refEntity: string,
  labelField: string,
): { readonly map: ReferenceLookupMap; readonly loading: boolean } {
  const { queryQn, labelKey } = referenceLookupSource(featureName, refEntity, labelField);
  const result = useQuery<{ rows: ReadonlyArray<Record<string, unknown>> }>(queryQn, {
    limit: REFERENCE_LIST_LOOKUP_LIMIT,
  });
  const translate = useTranslation();
  const systemLabel = SYSTEM_REFERENCE_LABELS[`${featureName}:${refEntity}`];
  const map = useMemo(() => {
    const out = new Map<string, string>();
    for (const row of result.data?.rows ?? []) {
      const id = row["id"];
      if (id === undefined || id === null) continue;
      const idStr = String(id);
      const label = row[labelKey] ?? id;
      out.set(idStr, String(label));
    }
    // System-scope ids (e.g. SYSTEM_TENANT_ID) never have a backing row, so
    // the bulk lookup above never covers them — inject the label directly.
    if (systemLabel !== undefined) out.set(systemLabel.id, translate(systemLabel.labelKey));
    return out;
  }, [result.data, labelKey, systemLabel, translate]);
  return { map, loading: result.loading };
}
