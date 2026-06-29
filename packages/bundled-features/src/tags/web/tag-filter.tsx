// @runtime client
// TagFilter — a drop-in tag filter for ANY entityList toolbar. Register it as
// the list's header slot (`screen.slots.header`) and mark `id` filterable is NOT
// needed — the renderer passes this control the list's screenId, and picking
// tags resolves the matching row ids and narrows the list via an id-set URL
// filter (`<screenId>.f.id=…`, applied as `{ field: "id", op: "in" }`). No host
// schema change: any list gets tag-filtering by mounting this in its header.
//
// ponytail: resolves ids from the assignment list (first 500 rows) + an id-IN
// URL filter — fine for typical tag volumes. For huge assignment sets add a
// server-side `entitiesByTag` query + a server-side join filter instead.

import {
  useListUrlState,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { TagsQueries } from "../constants";
import { TagPicker } from "./tag-picker";

// Tags chosen but zero matching entities → filter to a value that matches no row
// (so the list shows empty), instead of clearing the filter (which shows all).
const NO_MATCH = "__tags_no_match__";

type AssignmentRow = {
  readonly tagId: string;
  readonly entityType: string;
  readonly entityId: string;
};

export function TagFilter({
  entityName,
  screenId,
}: {
  readonly entityName: string;
  readonly entityId?: string | null;
  readonly screenId?: string;
}): ReactNode {
  const { Button } = usePrimitives();
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const assignments = useQuery<{ rows: readonly AssignmentRow[] }>(TagsQueries.assignmentList, {
    limit: 500,
  });
  // Unconditional (Rules of Hooks). The renderer always passes a screenId in the
  // header slot; the fallback namespace is inert if it ever runs standalone.
  const urlState = useListUrlState(screenId ?? "__tag-filter__");

  const applyFilter = (tagIds: readonly string[]): void => {
    setSelected(tagIds);
    if (tagIds.length === 0) {
      urlState.setFilter("id", []);
      return;
    }
    const wanted = new Set(tagIds);
    const ids = [
      ...new Set(
        (assignments.data?.rows ?? [])
          .filter((a) => a.entityType === entityName && wanted.has(a.tagId))
          .map((a) => a.entityId),
      ),
    ];
    urlState.setFilter("id", ids.length > 0 ? ids : [NO_MATCH]);
  };

  const label =
    selected.length > 0
      ? t("tags.filter.active", { count: selected.length })
      : t("tags.filter.label");

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} testId="tag-filter-open">
        {label}
      </Button>
      <TagPicker
        entityType={entityName}
        value={selected}
        onChange={applyFilter}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
