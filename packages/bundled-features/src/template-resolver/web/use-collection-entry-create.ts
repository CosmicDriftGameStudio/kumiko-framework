import type { TargetRef } from "@cosmicdrift/kumiko-framework/engine";
import { useLocale, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { useDispatchTarget } from "@cosmicdrift/kumiko-renderer/web";
import { useState } from "react";
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from "./constants.ts";
import { refreshTree } from "./content-tree-provider.ts";
import { collectionHandlerName } from "./qualified-names.ts";
import { useCollectionEditorContext } from "./use-collection-editor-context.ts";
import { useContentWrite } from "./use-content-write.ts";

type CreateTargetArgs = { collectionId?: string; folder?: string };

function readCreateTargetArgs(target: TargetRef): {
  readonly collectionId: string | undefined;
  readonly folder: string | null;
} {
  // @cast-boundary visual-tree-args — same de-erasure as the edit resolver; a missing
  // collectionId (hand-edited URL) leaves the form without a collection to write to.
  const args = target.args as CreateTargetArgs | undefined;
  const folder = args?.folder !== undefined && args.folder !== "" ? args.folder : null;
  return { collectionId: args?.collectionId, folder };
}

export function useCollectionEntryCreate(target: TargetRef, tenantId: string | undefined) {
  const { collectionId, folder } = readCreateTargetArgs(target);
  const t = useTranslation();
  const locale = useLocale().locale();
  const dispatchTarget = useDispatchTarget();
  const editorContext = useCollectionEditorContext(collectionId);
  const { collection, canWrite } = editorContext;
  const { submitting, error, writeScoped } = useContentWrite();

  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const slugValid = slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug);
  const disabled = submitting || !canWrite || collectionId === undefined;
  const headerTitle = t("template-resolver.editor.newEntryTitle", {
    label: collection !== undefined ? t(collection.nav.label) : "",
  });

  const create = async (): Promise<void> => {
    // skip: nothing to write to, or the slug is invalid (the field already shows the issue)
    if (collectionId === undefined || !slugValid) return;
    const requestedOverride = collection?.ownership === "user" ? undefined : tenantId;
    const written = await writeScoped(
      collectionHandlerName(collectionId),
      {
        slug,
        locale,
        title,
        content: content.length > 0 ? content : null,
        folder,
        createOnly: true,
      },
      requestedOverride,
    );
    // skip: useContentWrite already set the failure text
    if (written === null) return;
    const { response, tenantIdOverride } = written;
    refreshTree(collectionId);
    dispatchTarget({
      featureId: "template-resolver",
      action: "edit",
      args: {
        slug: response.slug,
        locale: response.locale,
        collectionId,
        ...(tenantIdOverride !== undefined && { tenantIdOverride }),
      },
    });
  };

  return {
    editorContext,
    headerTitle,
    slug,
    setSlug,
    title,
    setTitle,
    content,
    setContent,
    slugValid,
    createDisabled: disabled || !slugValid || title === "",
    slugInvalid: slug !== "" && !slugValid,
    disabled,
    submitting,
    error,
    create,
  };
}
