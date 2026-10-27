import type { TargetRef } from "@cosmicdrift/kumiko-framework/engine";
import {
  FormScreenLayout,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useEffect, useState } from "react";
import { ContentField } from "./content-field.tsx";
import { refreshTree, TEXT_BLOCK_TREE_KEY } from "./content-tree-provider.ts";
import { convertLegacyVariableText } from "./legacy-variable-text.ts";
import {
  collectionHandlerName,
  collectionQueryName,
  TemplateResolverHandlers,
  TemplateResolverQueries,
} from "./qualified-names.ts";
import { useCollectionEditorContext } from "./use-collection-editor-context.ts";
import { useContentWrite } from "./use-content-write.ts";

type TextBlock = {
  readonly slug: string;
  readonly locale: string;
  readonly title: string | null;
  readonly content: string | null;
  readonly contentFormat: string;
  readonly folder: string | null;
  readonly modifiedAt: string | null;
};

export function TextBlockEditor({
  target,
}: {
  readonly target: TargetRef;
  // onClose stays part of the resolver contract (the visual panel passes it)
  // but is unused: tree selection navigates, there is no close button.
  readonly onClose: () => void;
}): ReactNode {
  // @cast-boundary visual-tree-args — TargetRef.args is erased to
  // Record<string, unknown>; the resolver knows the action shape (see the
  // treeActions.edit definition in feature.ts) and de-erases per action, the
  // same way event payloads do. Optional chaining absorbs missing fields so a
  // hand-edited URL cannot crash the editor.
  const args = target.args as
    | { slug?: string; locale?: string; collectionId?: string; tenantIdOverride?: string }
    | undefined;
  const slug = args?.slug ?? "";
  const locale = args?.locale ?? "";
  const tenantIdOverride = args?.tenantIdOverride;
  // Which collection the node came from. Absent → the public text-block pair,
  // which is what the hand-wired content tree uses.
  const collectionId = args?.collectionId;

  const { Field, Input, Button, Banner, PageHeader, Section } = usePrimitives();
  const t = useTranslation();
  const editorContext = useCollectionEditorContext(collectionId);
  const { contentFormat, canWrite } = editorContext;
  const { submitting, error: saveError, clearError, write } = useContentWrite();

  // Same split as the tree provider: a node without a collection reads through
  // the public by-slug, a collection node through that collection's handlers.
  const readQuery =
    collectionId === undefined
      ? TemplateResolverQueries.bySlug
      : collectionQueryName(collectionId, "item");
  const writeHandler =
    collectionId === undefined ? TemplateResolverHandlers.set : collectionHandlerName(collectionId);
  const {
    data: loaded,
    loading,
    error: loadError,
  } = useQuery<TextBlock | null>(
    readQuery,
    { slug, locale, ...(tenantIdOverride !== undefined && { tenantIdOverride }) },
    { enabled: slug !== "" && locale !== "" },
  );

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Sync loaded data into the form state. loaded === null means the block does
  // not exist yet — empty form for the create flow.
  // kumiko-lint-ignore no-raw-hooks not yet converted to the framework hook set
  useEffect(() => {
    if (loading) return;
    const loadedContent = loaded?.content ?? "";
    setTitle(loaded?.title ?? "");
    setContent(
      contentFormat === "document" ? convertLegacyVariableText(loadedContent) : loadedContent,
    );
    clearError();
    setSavedMsg(null);
  }, [loading, loaded, contentFormat, clearError]);

  const handleSave = async (): Promise<void> => {
    setSavedMsg(null);
    const response = await write(writeHandler, {
      slug,
      locale,
      title,
      content: content.length > 0 ? content : null,
      folder: loaded?.folder ?? null,
      // A collection derives its storage format on the server; the public set keeps what was saved.
      ...(collectionId === undefined &&
        loaded?.contentFormat !== undefined && { contentFormat: loaded.contentFormat }),
      ...(tenantIdOverride !== undefined && { tenantIdOverride }),
    });
    if (response === null) return;
    refreshTree(collectionId ?? TEXT_BLOCK_TREE_KEY);
    setSavedMsg(
      response.isNew ? t("template-resolver.editor.created") : t("template-resolver.editor.saved"),
    );
  };

  const disabled = submitting || loading || !canWrite;
  const headerTitle = title || slug || undefined;

  return (
    <>
      {/* The editor opens beside the routed screen, so without this the shell header keeps that screen's title. */}
      {PageHeader !== undefined && headerTitle !== undefined && <PageHeader title={headerTitle} />}
      <FormScreenLayout
        onSubmit={() => {
          void handleSave();
        }}
        testId="text-block-editor"
        description={locale !== "" ? `${slug} · (${locale})` : slug}
        actions={
          canWrite ? (
            <Button type="submit" loading={submitting} disabled={disabled}>
              {submitting
                ? t("template-resolver.editor.saving")
                : t("template-resolver.editor.save")}
            </Button>
          ) : undefined
        }
      >
        <Section>
          {loading && <Banner variant="loading">{t("template-resolver.editor.loading")}</Banner>}
          {loadError !== null && (
            <Banner variant="error">
              {t("template-resolver.editor.loadFailed")}: {loadError.code}
            </Banner>
          )}
          {!canWrite && !loading && (
            <Banner variant="info">{t("template-resolver.editor.readOnly")}</Banner>
          )}
          <Field id="text-block-title" label={t("template-resolver.editor.titleLabel")} required>
            <Input
              kind="text"
              id="text-block-title"
              name="text-block-title"
              value={title}
              onChange={setTitle}
              disabled={disabled}
              required
            />
          </Field>
          <ContentField
            editorContext={editorContext}
            value={content}
            onChange={setContent}
            disabled={disabled}
          />
          {saveError !== null && <Banner variant="error">{saveError}</Banner>}
          {savedMsg !== null && <Banner variant="info">{savedMsg}</Banner>}
        </Section>
      </FormScreenLayout>
    </>
  );
}
