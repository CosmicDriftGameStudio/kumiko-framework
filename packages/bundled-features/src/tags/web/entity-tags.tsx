// @runtime client
// EntityTags — read-only colored tag row for ANY entity. Drop it on a card or
// detail view: <EntityTags entityName="note" entityId={id} />. Loads the
// catalog (for name+color) and the entity's assignments, renders a TagChip per
// assigned tag. Renders nothing when the entity has no tags.

import { useQuery } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { TagsQueries } from "../constants";
import { TagChip } from "./tag-chip";

type TagRow = { readonly id: string; readonly name: string; readonly color?: string | null };
type AssignmentRow = {
  readonly tagId: string;
  readonly entityType: string;
  readonly entityId: string;
};

export function EntityTags({
  entityName,
  entityId,
}: {
  readonly entityName: string;
  readonly entityId: string | null;
}): ReactNode {
  const enabled = entityId !== null;
  const catalog = useQuery<{ rows: readonly TagRow[] }>(TagsQueries.tagList, {}, { enabled });
  const assignments = useQuery<{ rows: readonly AssignmentRow[] }>(
    TagsQueries.assignmentList,
    { filter: { field: "entityId", op: "eq", value: entityId } },
    { enabled },
  );

  if (entityId === null) return null;
  const byId = new Map((catalog.data?.rows ?? []).map((t) => [t.id, t]));
  const assigned = (assignments.data?.rows ?? []).filter((r) => r.entityType === entityName);
  if (assigned.length === 0) return null;

  return (
    <div data-testid="entity-tags" className="flex flex-wrap gap-1">
      {assigned.map((a) => {
        const tag = byId.get(a.tagId);
        return <TagChip key={a.tagId} name={tag?.name ?? a.tagId} color={tag?.color} />;
      })}
    </div>
  );
}
