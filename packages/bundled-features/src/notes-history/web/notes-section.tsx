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
  type ExtensionSubmitResult,
  formatWhen,
  useDispatcher,
  useExtensionFormSubmit,
  useLocale,
  usePrimitives,
  useQuery,
  useTranslation,
  useUnsavedInputSource,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useRef, useState } from "react";
import { NotesHistoryHandlers, NotesHistoryQueries } from "./constants.ts";

type NoteRow = {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly authorId: string;
  // Null for pre-authorName history; shredded authors arrive as PII_ERASED_SENTINEL.
  readonly authorName: string | null;
  readonly body: string;
  readonly insertedAt: string;
};

// Matches @cosmicdrift/kumiko-framework/crypto PII_ERASED_SENTINEL — cannot
// import that module from client code (runtime-isolation).
const PII_ERASED_SENTINEL = "[[erased]]";

function displayAuthorName(authorName: string | null, unknownLabel: string): string {
  return authorName && authorName !== PII_ERASED_SENTINEL ? authorName : unknownLabel;
}
type NoteListResponse = { readonly rows: readonly NoteRow[] };

export function NotesSection({
  entityName,
  entityId,
}: {
  readonly entityName: string;
  readonly entityId: string | null;
}): ReactNode {
  const { Banner, Button, Grid, Heading, Text, Input } = usePrimitives();
  const t = useTranslation();
  const locale = useLocale().locale();
  const dispatcher = useDispatcher();
  const enabled = entityId !== null;
  const notes = useQuery<NoteListResponse>(
    NotesHistoryQueries.noteList,
    {
      // entityType server-side, not just entityId: it collapses the parent-ref
      // read gate to this one host entity instead of every registered one.
      filters: [
        { field: "entityType", op: "eq", value: entityName },
        { field: "entityId", op: "eq", value: entityId },
      ],
      sort: "insertedAt",
      sortDirection: "desc",
      // ponytail: fixed page, no "load more" — an entity with a note history
      // longer than this shows only its 200 newest. Upgrade to cursor
      // pagination (the query already supports `cursor`) if that's hit.
      limit: 200,
    },
    { enabled },
  );
  const [draft, setDraftState] = useState("");
  // The leave guard asks right after a save, before React re-renders the cleared draft.
  const draftRef = useRef("");
  const setDraft = (next: string): void => {
    draftRef.current = next;
    setDraftState(next);
  };
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  useUnsavedInputSource(() => draftRef.current.trim() !== "");

  const writeDraft = async (targetEntityId: string): Promise<ExtensionSubmitResult> => {
    const body = draftRef.current.trim();
    if (body === "") return { isSuccess: true };
    const result = await dispatcher.write(NotesHistoryHandlers.addNote, {
      entityType: entityName,
      entityId: targetEntityId,
      body,
    });
    if (!result.isSuccess) return { isSuccess: false, errorKey: result.error.i18nKey };
    setDraft("");
    await notes.refetch();
    return { isSuccess: true };
  };
  // Inside a form the typed note is written by its one Save; only a standalone section adds it.
  const composed = useExtensionFormSubmit({
    dirty: draft.trim() !== "",
    onSubmit: (ctx) => writeDraft(ctx.entityId),
  });

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
    if (draft.trim() === "") return;
    setBusy(true);
    setErrorKey(null);
    void (async () => {
      try {
        const result = await writeDraft(entityId);
        if (!result.isSuccess) setErrorKey(result.errorKey ?? null);
      } finally {
        setBusy(false);
      }
    })();
  };

  // No own Card/SectionCard here — the host (ExtensionSectionMount) already
  // frames this whole component in one card; a nested card would double the
  // border/padding. "New note" and "History" are sub-headers within that
  // single frame instead.
  return (
    <Grid columns={1} testId="notes-section">
      <div className="flex flex-col gap-3" data-testid="notes-section-new">
        <Heading variant="section">{t("notesHistory.section.newNoteTitle")}</Heading>
        <Input
          kind="textarea"
          id="notes-section-draft"
          name="draft"
          value={draft}
          onChange={setDraft}
          {...(!composed && {
            onSubmitShortcut: () => {
              if (!busy && draft.trim() !== "") addNote();
            },
          })}
        />
        {!composed && (
          <div className="flex items-center justify-between gap-2">
            <Text variant="small">{t("notesHistory.section.shortcutHint")}</Text>
            <Button
              variant="primary"
              disabled={busy || draft.trim() === ""}
              onClick={() => addNote()}
              testId="notes-section-add"
            >
              {busy ? t("notesHistory.section.working") : t("notesHistory.section.add")}
            </Button>
          </div>
        )}
        {errorKey !== null && (
          <Banner variant="error" testId="notes-section-action-error">
            <Text>{t(errorKey)}</Text>
          </Banner>
        )}
      </div>

      <div className="flex flex-col gap-3" data-testid="notes-section-history">
        <Heading variant="section">{t("notesHistory.section.historyTitle")}</Heading>
        {rows.length === 0 ? (
          <Text variant="small">{t("notesHistory.section.empty")}</Text>
        ) : (
          <div className="flex flex-col divide-y">
            {rows.map((n) => (
              <div
                key={n.id}
                data-testid={`notes-section-row-${n.id}`}
                className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
              >
                <Text testId={`notes-section-body-${n.id}`}>{n.body}</Text>
                <Text variant="small" testId={`notes-section-meta-${n.id}`}>
                  {t("notesHistory.section.meta", {
                    author: displayAuthorName(
                      n.authorName,
                      t("notesHistory.section.authorUnknown"),
                    ),
                    date: formatWhen(n.insertedAt, locale),
                  })}
                </Text>
              </div>
            ))}
          </div>
        )}
      </div>
    </Grid>
  );
}
