// @runtime client
// TagSection — drop-in tag editor for ANY entity, GitLab-labels style. Shows the
// entity's tags as colored chips plus an "Edit tags" button that opens the
// shared TagPicker modal (pick + manage). Applying the picker diffs the
// selection against the current assignments and runs idempotent assign/remove
// writes — so the section owns its state and refetches after each change; it is
// NOT part of a host form's save.
//
// Two ways to mount (both need tagsClient() registered once, for i18n):
//   - standalone:   <TagSection entityName="note" entityId={noteId} />
//   - extension:    a screen-schema section with
//                   component: { react: { __component: TAGS_SECTION_EXTENSION_NAME } }
//                   (RenderEdit passes { entityName, entityId }).

import {
  useDispatcher,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { TagsHandlers, TagsQueries } from "../constants";
import { TagChip } from "./tag-chip";
import { TagPicker } from "./tag-picker";

type TagRow = { readonly id: string; readonly name: string; readonly color?: string | null };
type AssignmentRow = {
  readonly tagId: string;
  readonly entityType: string;
  readonly entityId: string;
};
type TagListResponse = { readonly rows: readonly TagRow[] };
type AssignmentListResponse = { readonly rows: readonly AssignmentRow[] };

// What changed between the entity's current tags and the picker's new selection.
export function tagSelectionDelta(
  prev: readonly string[],
  next: readonly string[],
): { readonly added: readonly string[]; readonly removed: readonly string[] } {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  return {
    added: next.filter((id) => !prevSet.has(id)),
    removed: prev.filter((id) => !nextSet.has(id)),
  };
}

export function TagSection({
  entityName,
  entityId,
}: {
  readonly entityName: string;
  readonly entityId: string | null;
}): ReactNode {
  const { Banner, Button, Text } = usePrimitives();
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const enabled = entityId !== null;
  const catalog = useQuery<TagListResponse>(TagsQueries.tagList, {}, { enabled });
  const assignments = useQuery<AssignmentListResponse>(
    TagsQueries.assignmentList,
    { filter: { field: "entityId", op: "eq", value: entityId } },
    { enabled },
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  if (entityId === null) {
    return (
      <Banner variant="info" testId="tags-section-create-mode">
        <Text>{t("tags.section.createMode")}</Text>
      </Banner>
    );
  }
  if (
    (catalog.loading && catalog.data === null) ||
    (assignments.loading && assignments.data === null)
  ) {
    return (
      <Banner variant="loading" testId="tags-section-loading">
        <Text>{t("tags.section.loading")}</Text>
      </Banner>
    );
  }
  const queryError = catalog.error ?? assignments.error;
  if (queryError) {
    return (
      <Banner variant="error" testId="tags-section-error">
        <Text>{t(queryError.i18nKey, queryError.i18nParams)}</Text>
      </Banner>
    );
  }

  const byId = new Map((catalog.data?.rows ?? []).map((tg) => [tg.id, tg]));
  const assignedIds = (assignments.data?.rows ?? [])
    .filter((r) => r.entityType === entityName)
    .map((r) => r.tagId);

  const refetch = async (): Promise<void> => {
    await Promise.all([catalog.refetch(), assignments.refetch()]);
  };

  const writeOk = async (type: string, payload: Record<string, unknown>): Promise<boolean> => {
    const result = await dispatcher.write(type, payload);
    if (!result.isSuccess) {
      setErrorKey(result.error.i18nKey);
      return false;
    }
    return true;
  };

  const onPicked = (next: readonly string[]): void => {
    const { added, removed } = tagSelectionDelta(assignedIds, next);
    if (added.length === 0 && removed.length === 0) return;
    setBusy(true);
    setErrorKey(null);
    void (async () => {
      try {
        for (const tagId of added) {
          if (!(await writeOk(TagsHandlers.assignTag, { tagId, entityType: entityName, entityId })))
            return;
        }
        for (const tagId of removed) {
          if (!(await writeOk(TagsHandlers.removeTag, { tagId, entityType: entityName, entityId })))
            return;
        }
        await refetch();
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div data-testid="tags-section" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        {assignedIds.length === 0 ? (
          <Text variant="small">{t("tags.section.none")}</Text>
        ) : (
          assignedIds.map((id) => {
            const tag = byId.get(id);
            return <TagChip key={id} name={tag?.name ?? id} color={tag?.color} />;
          })
        )}
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => setPickerOpen(true)}
          testId="tags-section-edit"
        >
          {busy ? t("tags.section.working") : t("tags.section.edit")}
        </Button>
      </div>

      <TagPicker
        entityType={entityName}
        value={assignedIds}
        onChange={onPicked}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
      />

      {errorKey !== null && (
        <Banner variant="error" testId="tags-section-action-error">
          <Text>{t(errorKey)}</Text>
        </Banner>
      )}
    </div>
  );
}
