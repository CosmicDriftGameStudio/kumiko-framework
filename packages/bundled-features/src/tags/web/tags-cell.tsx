// @runtime client
// TagsCell — a reusable columnRenderer that shows an entity's tags as colored
// chips inline in a list row. Drop it into ANY entityList by declaring a labeled
// virtual column (no host-schema change), after mounting tagsClient():
//   columns: [
//     "title",
//     { field: "tags", label: "Tags",
//       renderer: { react: { __component: TAGS_COLUMN_RENDERER_NAME } } },
//   ]
// It reads the row's id (entity ids are unique, so entityType is unnecessary)
// and renders a TagChip per assigned tag; renders nothing when the row has none.
//
// ponytail: bulk-loads the assignment list (first 500) + the catalog once and
// filters per row — kumiko's useQuery dedupes the identical (type, payload)
// calls, so the whole column shares two queries, not two-per-row. For huge
// assignment sets add a server-side entitiesByTag query + join filter.

import { type ColumnRendererProps, useQuery } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { TagsQueries } from "../constants";
import { TagChip } from "./tag-chip";

type TagRow = { readonly id: string; readonly name: string; readonly color?: string | null };
type AssignmentRow = { readonly tagId: string; readonly entityId: string };

export function TagsCell({ row }: ColumnRendererProps): ReactNode {
  const entityId = String(row["id"] ?? "");
  const catalog = useQuery<{ rows: readonly TagRow[] }>(TagsQueries.tagList, {});
  const assignments = useQuery<{ rows: readonly AssignmentRow[] }>(TagsQueries.assignmentList, {
    limit: 500,
  });
  if (entityId === "") return null;
  const byId = new Map((catalog.data?.rows ?? []).map((t) => [t.id, t]));
  const tagIds = (assignments.data?.rows ?? [])
    .filter((a) => a.entityId === entityId)
    .map((a) => a.tagId);
  if (tagIds.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1" data-testid="tags-cell">
      {tagIds.map((id) => {
        const tag = byId.get(id);
        return <TagChip key={id} name={tag?.name ?? id} color={tag?.color} />;
      })}
    </div>
  );
}
