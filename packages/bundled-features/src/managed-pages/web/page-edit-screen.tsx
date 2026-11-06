import {
  dispatcherErrorTextWithFieldIssues,
  PreviewPane,
  useMutation,
  useNav,
  usePrimitives,
  useQuery,
  useTranslation,
  useUnsavedInputSource,
} from "@cosmicdrift/kumiko-renderer";
import { EditorWorkbench, LoadingState, StatusBadge } from "@cosmicdrift/kumiko-renderer/web";
import { type ReactNode, useRef, useState } from "react";
import { DocumentContentEditor } from "../../template-resolver/web/index.ts";
import {
  PAGE_CREATE_HANDLER,
  PAGE_DETAIL_QUERY,
  PAGE_EDIT_SCREEN_ID,
  PAGE_LIST_SCREEN_ID,
  PAGE_UPDATE_HANDLER,
} from "./constants.ts";
import type { LossyMarkdownFeature } from "./lossy-markdown.ts";
import {
  changesOf,
  createdIdOf,
  createPayloadOf,
  draftOfRecord,
  EMPTY_PAGE_DRAFT,
  isDraftDirty,
  lossyFeaturesOfRecord,
  type PageDraft,
  type PageRecord,
} from "./page-edit-draft.ts";
import { PageSettingsFields, PageSettingsSummary } from "./page-settings-rail.tsx";

const LOSSY_LABEL_KEYS: Readonly<Record<LossyMarkdownFeature, string>> = {
  image: "managed-pages:body.lossy.image",
  blockquote: "managed-pages:body.lossy.blockquote",
  code: "managed-pages:body.lossy.code",
  deepHeading: "managed-pages:body.lossy.deepHeading",
};

const BODY_EDITOR_ID = "managed-pages-page-body";
const TEST_ID = "page-workbench";

function PageEditor({
  record,
  onSaved,
}: {
  readonly record: PageRecord | null;
  readonly onSaved: (id: string | undefined) => void;
}): ReactNode {
  const t = useTranslation();
  const { Banner } = usePrimitives();
  // Computed once: the editor is remounted per record version, and every keystroke re-renders it.
  const [initial] = useState(() => (record === null ? EMPTY_PAGE_DRAFT : draftOfRecord(record)));
  const [lossyOnOpen] = useState(() => (record === null ? [] : lossyFeaturesOfRecord(record)));
  const savedRef = useRef(false);
  const [draft, setDraft] = useState<PageDraft>(initial);
  const [bodyEdited, setBodyEdited] = useState(false);
  const [resetCount, setResetCount] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const create = useMutation<{ readonly id?: string }>(PAGE_CREATE_HANDLER);
  const update = useMutation(PAGE_UPDATE_HANDLER);
  const dirty = isDraftDirty(draft, initial);
  // The leave guard runs synchronously after save, before React re-renders with the saved state.
  useUnsavedInputSource(() => dirty && !savedRef.current);

  const patch = (changes: Partial<PageDraft>): void => {
    savedRef.current = false;
    setDraft((current) => ({ ...current, ...changes }));
  };
  const canSave = dirty && draft.slug !== "" && draft.title !== "";

  const save = async (): Promise<void> => {
    setSaveError(null);
    const result =
      record === null
        ? await create.mutate(createPayloadOf(draft))
        : await update.mutate({
            id: record.id,
            version: record.version,
            changes: changesOf(draft, initial),
          });
    if (!result.isSuccess) {
      setSaveError(dispatcherErrorTextWithFieldIssues(result.error, t));
      return;
    }
    savedRef.current = true;
    onSaved(record === null ? createdIdOf(result.data) : record.id);
  };

  const discard = (): void => {
    setDraft(initial);
    setBodyEdited(false);
    setSaveError(null);
    setResetCount((count) => count + 1);
  };

  const showLossy = lossyOnOpen.length > 0 && !bodyEdited;
  const title =
    record === null
      ? t("screen:page-edit.createTitle")
      : draft.title === ""
        ? t("screen:page-edit.title")
        : draft.title;
  const publishedLabel = t(
    `managed-pages:entity:page:field:published:option:${draft.published ? "true" : "false"}`,
  );

  return (
    <EditorWorkbench
      testId={TEST_ID}
      title={title}
      status={
        <StatusBadge tone={draft.published ? "ok" : "muted"} testId={`${TEST_ID}-status`}>
          {publishedLabel}
        </StatusBadge>
      }
      info={{
        edit: t("managed-pages:editor.infoEdit"),
        preview: t("managed-pages:editor.infoPreview"),
      }}
      banners={
        showLossy && (
          <Banner variant="warning">
            {t("managed-pages:body.lossy.warning", {
              features: lossyOnOpen.map((feature) => t(LOSSY_LABEL_KEYS[feature])).join(", "),
            })}
          </Banner>
        )
      }
      edit={
        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          <DocumentContentEditor
            key={resetCount}
            id={BODY_EDITOR_ID}
            value={draft.bodyHtml}
            onChange={(bodyHtml) => {
              setBodyEdited(true);
              patch({ bodyHtml });
            }}
            variables={[]}
            readOnly={false}
          />
        </div>
      }
      preview={
        <PreviewPane
          target="web"
          content={draft.bodyHtml}
          editFormat="document"
          variables={{}}
          subject={{ kind: "body" }}
        />
      }
      rail={{
        edit: <PageSettingsFields draft={draft} onPatch={patch} testId={`${TEST_ID}-rail`} />,
        preview: <PageSettingsSummary draft={draft} testId={`${TEST_ID}-rail-preview`} />,
      }}
      save={{
        busy: create.pending || update.pending,
        canSave,
        dirty,
        onSave: () => void save(),
        onDiscard: discard,
        saveError,
        ...(record === null && { saveLabel: t("managed-pages:editor.create") }),
      }}
    />
  );
}

// Replaces the generated entityEdit form: one submit writes the settings and the body together.
export function PageEditScreen(): ReactNode {
  const t = useTranslation();
  const { Banner } = usePrimitives();
  const nav = useNav();
  const entityId = nav.route?.entityId;
  const detail = useQuery<PageRecord | null>(
    PAGE_DETAIL_QUERY,
    { id: entityId ?? "" },
    { enabled: entityId !== undefined },
  );
  const goAfterSave = (id: string | undefined): void => {
    if (entityId === undefined) {
      if (id === undefined) nav.navigate({ screenId: PAGE_LIST_SCREEN_ID });
      else nav.replace({ screenId: PAGE_EDIT_SCREEN_ID, entityId: id });
      return;
    }
    void detail.refetch();
  };
  if (entityId === undefined) return <PageEditor record={null} onSaved={goAfterSave} />;
  if (detail.error !== null) {
    return <Banner variant="error">{t("managed-pages:editor.loadFailed")}</Banner>;
  }
  if (detail.data === null) return <LoadingState />;
  return (
    <PageEditor
      key={`${detail.data.id}:${detail.data.version}`}
      record={detail.data}
      onSaved={goAfterSave}
    />
  );
}
