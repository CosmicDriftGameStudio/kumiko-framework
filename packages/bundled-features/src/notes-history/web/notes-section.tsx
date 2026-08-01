// @runtime client
// NotesSection — drop-in note history for ANY entity. Shows every note
// chronologically (newest first) with author + timestamp, plus a textarea to
// append a new one. Append-only: there is no edit/delete affordance because
// the write-handler doesn't expose one (see ../entity.ts) — a correction is a
// new entry.
//
// Two ways to mount (both need notesHistoryClient() registered once, for i18n):
//   - standalone:   <NotesSection entityName="contact" entityId={id} />
//   - extension:    a screen-schema section with
//                   component: { react: { __component: NOTES_SECTION_EXTENSION_NAME } }
//                   (RenderEdit passes { entityName, entityId }).

import {
  useDispatcher,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { NotesHistoryHandlers, NotesHistoryQueries } from "../constants";

type NoteRow = {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly authorId: string;
  readonly body: string;
  readonly insertedAt: string;
};
type NoteListResponse = { readonly rows: readonly NoteRow[] };

export function NotesSection({
  entityName,
  entityId,
}: {
  readonly entityName: string;
  readonly entityId: string | null;
}): ReactNode {
  const { Banner, Button, Text, Input } = usePrimitives();
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const enabled = entityId !== null;
  const notes = useQuery<NoteListResponse>(
    NotesHistoryQueries.noteList,
    {
      filter: { field: "entityId", op: "eq", value: entityId },
      sort: "insertedAt",
      sortDirection: "desc",
      // ponytail: fixed page, no "load more" — an entity with a note history
      // longer than this shows only its 200 newest. Upgrade to cursor
      // pagination (the query already supports `cursor`) if that's hit.
      limit: 200,
    },
    { enabled },
  );
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  if (entityId === null) {
    return (
      <Banner variant="info" testId="notes-section-create-mode">
        <Text>{t("notesHistory.section.createMode")}</Text>
      </Banner>
    );
  }
  if (notes.loading && notes.data === null) {
    return (
      <Banner variant="loading" testId="notes-section-loading">
        <Text>{t("notesHistory.section.loading")}</Text>
      </Banner>
    );
  }
  if (notes.error) {
    return (
      <Banner variant="error" testId="notes-section-error">
        <Text>{t(notes.error.i18nKey, notes.error.i18nParams)}</Text>
      </Banner>
    );
  }

  const rows = (notes.data?.rows ?? []).filter((n) => n.entityType === entityName);

  const addNote = (): void => {
    const body = draft.trim();
    if (body === "") return;
    setBusy(true);
    setErrorKey(null);
    void (async () => {
      try {
        const result = await dispatcher.write(NotesHistoryHandlers.addNote, {
          entityType: entityName,
          entityId,
          body,
        });
        if (!result.isSuccess) {
          setErrorKey(result.error.i18nKey);
          return;
        }
        setDraft("");
        await notes.refetch();
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div data-testid="notes-section" className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Input
          kind="textarea"
          id="notes-section-draft"
          name="draft"
          value={draft}
          onChange={setDraft}
        />
        <div>
          <Button
            variant="primary"
            disabled={busy || draft.trim() === ""}
            onClick={() => addNote()}
            testId="notes-section-add"
          >
            {busy ? t("notesHistory.section.working") : t("notesHistory.section.add")}
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <Text variant="small">{t("notesHistory.section.empty")}</Text>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((n) => (
            <div
              key={n.id}
              data-testid={`notes-section-row-${n.id}`}
              className="rounded-md border p-2"
            >
              <Text>{n.body}</Text>
              <Text variant="small">
                {t("notesHistory.section.meta", { author: n.authorId, date: n.insertedAt })}
              </Text>
            </div>
          ))}
        </div>
      )}

      {errorKey !== null && (
        <Banner variant="error" testId="notes-section-action-error">
          <Text>{t(errorKey)}</Text>
        </Banner>
      )}
    </div>
  );
}
