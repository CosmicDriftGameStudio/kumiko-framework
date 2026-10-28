import type { EditRelatedListSection } from "@cosmicdrift/kumiko-framework/ui-types";

// `parentFilter` sends the parent id as a server-side `filter` clause: the generic
// `<entity>:list` query understands `filter`, not an arbitrary `parentParam` key.
export function buildRelatedListParentPayload(
  section: Pick<EditRelatedListSection, "parentFilter" | "parentParam">,
  parentId: string,
): Readonly<Record<string, unknown>> {
  return section.parentFilter !== undefined
    ? { filter: { field: section.parentFilter.field, op: "eq" as const, value: parentId } }
    : { [section.parentParam ?? "id"]: parentId };
}
