import type { TargetRef } from "@cosmicdrift/kumiko-framework/engine";
import { useQuery, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { useEffect, useState } from "react";
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

type EditTargetArgs = {
  slug?: string;
  locale?: string;
  collectionId?: string;
  tenantIdOverride?: string;
};

export function useTextBlockEditor(target: TargetRef) {
  // @cast-boundary visual-tree-args — TargetRef.args is erased to
  // Record<string, unknown>; the resolver knows the action shape (see the
  // treeActions.edit definition in feature.ts) and de-erases per action, the
  // same way event payloads do. Optional chaining absorbs missing fields so a
  // hand-edited URL cannot crash the editor.
  const args = target.args as EditTargetArgs | undefined;
  const slug = args?.slug ?? "";
  const locale = args?.locale ?? "";
  const tenantIdOverride = args?.tenantIdOverride;
  // Which collection the node came from. Absent → the public text-block pair,
  // which is what the hand-wired content tree uses.
  const collectionId = args?.collectionId;

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
  // What is stored, to tell unsaved edits from the loaded state and to discard back to it.
  // Separate strings: the sync effect re-runs for a fresh `loaded` object and equal strings bail out of the update.
  const [baselineTitle, setBaselineTitle] = useState("");
  const [baselineContent, setBaselineContent] = useState("");

  // Sync loaded data into the form state. loaded === null means the block does
  // not exist yet — empty form for the create flow.
  // Keyed on the loaded primitives, not the result object: a refetch that returns identical
  // values must not wipe what the user is typing.
  const loadedTitle = loaded?.title ?? "";
  const loadedContent = loaded?.content ?? "";
  useEffect(() => {
    // skip: keep the form untouched until the query settles
    if (loading) return;
    const shownContent =
      contentFormat === "document" ? convertLegacyVariableText(loadedContent) : loadedContent;
    setTitle(loadedTitle);
    setContent(shownContent);
    setBaselineTitle(loadedTitle);
    setBaselineContent(shownContent);
    clearError();
    setSavedMsg(null);
  }, [loading, loadedTitle, loadedContent, contentFormat, clearError]);

  const save = async (): Promise<void> => {
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
    // skip: useContentWrite already set the failure text
    if (response === null) return;
    refreshTree(collectionId ?? TEXT_BLOCK_TREE_KEY);
    setBaselineTitle(title);
    setBaselineContent(content);
    setSavedMsg(
      response.isNew ? t("template-resolver.editor.created") : t("template-resolver.editor.saved"),
    );
  };

  const dirty = title !== baselineTitle || content !== baselineContent;
  const discard = (): void => {
    setTitle(baselineTitle);
    setContent(baselineContent);
    clearError();
    setSavedMsg(null);
  };

  return {
    slug,
    locale,
    dirty,
    discard,
    modifiedAt: loaded?.modifiedAt ?? null,
    editorContext,
    canWrite,
    loading,
    loadError,
    submitting,
    saveError,
    savedMsg,
    disabled: submitting || loading || !canWrite,
    saveLabelKey: submitting ? "template-resolver.editor.saving" : "template-resolver.editor.save",
    title,
    setTitle,
    content,
    setContent,
    save,
  };
}
