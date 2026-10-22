// Renderer-side eager load for reference fields.
//
// Each reference column of a list calls `<feature>:query:
// <refEntity>:list` (limit:200) once, builds a Map<uuid, displayValue>,
// and the renderer uses it as the cell display renderer.
//
// Strategy trade-offs:
//   - Server-side Drizzle joins would be more efficient (one query instead
//     of N+1) but would have to extend the executor API with lookupTables.
//     The renderer-side path wins for the MVP.
//   - limit:200 is a hard UX limit: with more entries in the referenced
//     entity, the last rows show only UUIDs. A searchable combobox plus a
//     server-side eager load with an ID whitelist will lift that later.
//
// The hook is call-stable: useQuery's internal cache shares the lookup map
// between list and edit form for the same entity, and live updates arrive
// via SSE (use-query-live).

import {
  REFERENCE_LOOKUP_SOURCES,
  SYSTEM_REFERENCE_LABELS,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { PII_ERASED_SENTINEL } from "@cosmicdrift/kumiko-types/kms-adapter-types";
import { useMemo } from "react";
import { toKebab } from "../app/qn.ts";
import { useTranslation } from "../i18n.tsx";
import { REFERENCE_LIST_LOOKUP_LIMIT } from "./reference-limits.ts";
import { useQuery } from "./use-query.ts";

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

// Where a reference field's option rows come from, and which of their keys
// holds the display text — the entity's own list handler plus `refLabelField`
// by default, or an author-supplied handler whose rows carry `label`,
// for targets with no readable column of their own.
export function referenceOptionSource(
  field: { readonly refLabelField?: string; readonly refOptionsQuery?: string },
  refFeature: string,
  refEntity: string,
): { readonly queryQn: string; readonly labelKey: string } {
  if (field.refOptionsQuery !== undefined) {
    return { queryQn: field.refOptionsQuery, labelKey: "label" };
  }
  return referenceLookupSource(refFeature, refEntity, field.refLabelField ?? "id");
}

/** Empty while the query loads (or fails), so callers fall back to the raw id.
 *  `featureName` is the reference's target feature, not the screen's. */
export function useReferenceLookup(
  featureName: string,
  refEntity: string,
  labelField: string,
): {
  readonly map: ReferenceLookupMap;
  readonly loading: boolean;
  readonly failed: boolean;
} {
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
      out.set(
        idStr,
        label === PII_ERASED_SENTINEL ? translate("kumiko.pii.erased") : String(label),
      );
    }
    // System-scope ids (e.g. SYSTEM_TENANT_ID) never have a backing row, so
    // the bulk lookup above never covers them — inject the label directly.
    if (systemLabel !== undefined) {
      for (const id of [systemLabel.id, ...(systemLabel.aliases ?? [])]) {
        out.set(id, translate(systemLabel.labelKey));
      }
    }
    return out;
  }, [result.data, labelKey, systemLabel, translate]);
  return { map, loading: result.loading, failed: result.error !== null };
}
