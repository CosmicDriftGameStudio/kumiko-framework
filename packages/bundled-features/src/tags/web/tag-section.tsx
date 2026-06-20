// @runtime client
// TagSection — drop-in tag manager for ANY entity, GitLab-labels style: one
// searchable multi-combobox showing the entity's tags as chips, with a compact
// row below to create-and-attach a brand-new tag. Tag writes are immediate
// (assign/remove are idempotent), so the section owns its state and refetches
// after each action — it is NOT part of a host form's save.
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

type TagRow = { readonly id: string; readonly name: string; readonly color?: string | null };
type AssignmentRow = {
  readonly tagId: string;
  readonly entityType: string;
  readonly entityId: string;
};
type TagListResponse = { readonly rows: readonly TagRow[] };
type AssignmentListResponse = { readonly rows: readonly AssignmentRow[] };

// What changed between the entity's current tags and the combobox's new
// selection. A single combobox toggle yields one add or one remove; the diff
// stays correct for a batch selection too.
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
  const { Banner, Button, Field, Input, Text } = usePrimitives();
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const enabled = entityId !== null;
  const catalog = useQuery<TagListResponse>(TagsQueries.tagList, {}, { enabled });
  const assignments = useQuery<AssignmentListResponse>(
    TagsQueries.assignmentList,
    { filter: { field: "entityId", op: "eq", value: entityId } },
    { enabled },
  );
  const [newName, setNewName] = useState("");
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

  const catalogTags = catalog.data?.rows ?? [];
  const assignedIds = (assignments.data?.rows ?? [])
    .filter((r) => r.entityType === entityName)
    .map((r) => r.tagId);
  // Catalog drives the options; an assigned tag missing from the catalog (none
  // in v1 — no delete-tag yet) is appended so it stays removable.
  const nameById = new Map(catalogTags.map((tg) => [tg.id, tg.name]));
  const options = [...new Set([...catalogTags.map((tg) => tg.id), ...assignedIds])].map((id) => ({
    value: id,
    label: nameById.get(id) ?? id,
  }));

  const refetch = async (): Promise<void> => {
    await Promise.all([catalog.refetch(), assignments.refetch()]);
  };

  // Runs a write-sequence (each step returns false + sets errorKey on failure,
  // stopping the sequence) and refetches to server-truth when it completes.
  const apply = async (writes: () => Promise<boolean>): Promise<void> => {
    setBusy(true);
    setErrorKey(null);
    try {
      if (await writes()) await refetch();
    } finally {
      setBusy(false);
    }
  };

  const writeOk = async (type: string, payload: Record<string, unknown>): Promise<boolean> => {
    const result = await dispatcher.write(type, payload);
    if (!result.isSuccess) {
      setErrorKey(result.error.i18nKey);
      return false;
    }
    return true;
  };

  const onSelectionChange = (next: readonly string[]): void => {
    const { added, removed } = tagSelectionDelta(assignedIds, next);
    if (added.length === 0 && removed.length === 0) return;
    void apply(async () => {
      for (const tagId of added) {
        if (!(await writeOk(TagsHandlers.assignTag, { tagId, entityType: entityName, entityId })))
          return false;
      }
      for (const tagId of removed) {
        if (!(await writeOk(TagsHandlers.removeTag, { tagId, entityType: entityName, entityId })))
          return false;
      }
      return true;
    });
  };

  const createAndAssign = (): void => {
    const name = newName.trim();
    if (name === "") return;
    void apply(async () => {
      const created = await dispatcher.write<{ id: string }>(TagsHandlers.createTag, { name });
      if (!created.isSuccess) {
        setErrorKey(created.error.i18nKey);
        return false;
      }
      if (
        !(await writeOk(TagsHandlers.assignTag, {
          tagId: created.data.id,
          entityType: entityName,
          entityId,
        }))
      ) {
        return false;
      }
      setNewName("");
      return true;
    });
  };

  return (
    <div data-testid="tags-section">
      <Field id="tags-section-select" label={t("tags.section.label")}>
        <Input
          kind="combobox"
          multiple
          id="tags-section-select"
          name="tags"
          options={options}
          value={assignedIds}
          onChange={onSelectionChange}
          disabled={busy}
          placeholder={t("tags.section.placeholder")}
          emptyText={t("tags.section.empty")}
        />
      </Field>

      {/* ponytail: separate create row — the shared combobox has no create-on-type
          affordance. Fold create into the dropdown's Command.Empty if/when the
          renderer-web combobox grows a freeSolo/onCreate prop. */}
      <Field id="tags-section-new" label={t("tags.section.newLabel")}>
        <Input
          kind="text"
          id="tags-section-new"
          name="newTag"
          value={newName}
          onChange={setNewName}
        />
      </Field>
      <Button
        variant="secondary"
        disabled={busy || newName.trim() === ""}
        onClick={() => createAndAssign()}
        testId="tags-section-create"
      >
        {busy ? t("tags.section.working") : t("tags.section.create")}
      </Button>

      {errorKey !== null && (
        <Banner variant="error" testId="tags-section-action-error">
          <Text>{t(errorKey)}</Text>
        </Banner>
      )}
    </div>
  );
}
