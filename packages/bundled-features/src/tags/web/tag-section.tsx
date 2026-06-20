// @runtime client
// TagSection — drop-in tag manager for ANY entity. Given an entityName +
// entityId it shows the entity's current tags and lets the user attach an
// existing tag, create-and-attach a new one, or detach a tag. Tag writes are
// immediate (assign/remove are idempotent), so the section owns its own state
// and refetches after each action — it is NOT part of a host form's save.
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

// Structural shape of a dispatcher write result for the generic action wrapper.
// The real WriteResult (a discriminated union) is assignable to this; narrowing
// on `isSuccess` reaches `error.i18nKey` without importing server-side types.
type ActionResult =
  | { readonly isSuccess: true }
  | { readonly isSuccess: false; readonly error: { readonly i18nKey: string } };

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
  const byId = new Map(catalogTags.map((tg) => [tg.id, tg]));
  const assignedRows = (assignments.data?.rows ?? []).filter((r) => r.entityType === entityName);
  const assignedIds = new Set(assignedRows.map((r) => r.tagId));
  const assignedTags = assignedRows.map((r) => byId.get(r.tagId) ?? { id: r.tagId, name: r.tagId });
  const available = catalogTags.filter((tg) => !assignedIds.has(tg.id));

  const refetch = async (): Promise<void> => {
    await Promise.all([catalog.refetch(), assignments.refetch()]);
  };

  const run = async (action: () => Promise<ActionResult>): Promise<void> => {
    setBusy(true);
    setErrorKey(null);
    try {
      const result = await action();
      if (!result.isSuccess) {
        setErrorKey(result.error.i18nKey);
        return;
      }
      await refetch();
    } finally {
      setBusy(false);
    }
  };

  const assign = (tagId: string): Promise<void> =>
    run(() =>
      dispatcher.write(TagsHandlers.assignTag, { tagId, entityType: entityName, entityId }),
    );

  const detach = (tagId: string): Promise<void> =>
    run(() =>
      dispatcher.write(TagsHandlers.removeTag, { tagId, entityType: entityName, entityId }),
    );

  const createAndAssign = async (): Promise<void> => {
    const name = newName.trim();
    if (name === "") return;
    setBusy(true);
    setErrorKey(null);
    try {
      const created = await dispatcher.write<{ id: string }>(TagsHandlers.createTag, { name });
      if (!created.isSuccess) {
        setErrorKey(created.error.i18nKey);
        return;
      }
      const assigned = await dispatcher.write(TagsHandlers.assignTag, {
        tagId: created.data.id,
        entityType: entityName,
        entityId,
      });
      if (!assigned.isSuccess) {
        setErrorKey(assigned.error.i18nKey);
        return;
      }
      setNewName("");
      await refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="tags-section">
      {assignedTags.length === 0 ? (
        <Text>{t("tags.section.none")}</Text>
      ) : (
        assignedTags.map((tg) => (
          <Button
            key={tg.id}
            variant="secondary"
            disabled={busy}
            onClick={() => void detach(tg.id)}
            testId={`tags-section-remove-${tg.id}`}
          >
            {`${tg.name} ✕`}
          </Button>
        ))
      )}

      {available.map((tg) => (
        <Button
          key={tg.id}
          variant="secondary"
          disabled={busy}
          onClick={() => void assign(tg.id)}
          testId={`tags-section-assign-${tg.id}`}
        >
          {`+ ${tg.name}`}
        </Button>
      ))}

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
        variant="primary"
        disabled={busy || newName.trim() === ""}
        onClick={() => void createAndAssign()}
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
