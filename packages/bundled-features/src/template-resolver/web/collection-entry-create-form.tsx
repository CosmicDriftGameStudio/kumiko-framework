import type { TargetRef } from "@cosmicdrift/kumiko-framework/engine";
import type { FieldIssue } from "@cosmicdrift/kumiko-framework/errors";
import {
  FormScreenLayout,
  useLocale,
  usePrimitives,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { useDispatchTarget } from "@cosmicdrift/kumiko-renderer/web";
import { type ReactNode, useState } from "react";
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from "./constants.ts";
import { ContentField } from "./content-field.tsx";
import { refreshTree } from "./content-tree-provider.ts";
import { collectionHandlerName } from "./qualified-names.ts";
import { useCollectionEditorContext } from "./use-collection-editor-context.ts";
import { useContentWrite } from "./use-content-write.ts";

const SLUG_INVALID_ISSUE: FieldIssue = {
  path: "slug",
  code: "slug_invalid",
  i18nKey: "template-resolver.editor.slugInvalid",
};

// A new entry in the app's own locale; the tree then lists it under that locale like any other.
export function CollectionEntryCreateForm({
  target,
}: {
  readonly target: TargetRef;
  readonly onClose: () => void;
}): ReactNode {
  // @cast-boundary visual-tree-args — same de-erasure as the edit resolver; a missing
  // collectionId (hand-edited URL) leaves the form without a collection to write to.
  const args = target.args as { collectionId?: string; folder?: string } | undefined;
  const collectionId = args?.collectionId;
  const folder = args?.folder !== undefined && args.folder !== "" ? args.folder : null;

  const { Field, Input, Button, Banner, PageHeader, Section } = usePrimitives();
  const t = useTranslation();
  const locale = useLocale().locale();
  const dispatchTarget = useDispatchTarget();
  const editorContext = useCollectionEditorContext(collectionId);
  const { collection, canWrite } = editorContext;
  const { submitting, error, write } = useContentWrite();

  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const slugValid = slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug);
  const slugInvalid = slug !== "" && !slugValid;
  const disabled = submitting || !canWrite || collectionId === undefined;
  const headerTitle = t("template-resolver.editor.newEntryTitle", {
    label: collection !== undefined ? t(collection.nav.label) : "",
  });

  const handleCreate = async (): Promise<void> => {
    if (collectionId === undefined || !slugValid) return;
    const response = await write(collectionHandlerName(collectionId), {
      slug,
      locale,
      title,
      content: content.length > 0 ? content : null,
      folder,
      createOnly: true,
    });
    if (response === null) return;
    refreshTree(collectionId);
    dispatchTarget({
      featureId: "template-resolver",
      action: "edit",
      args: { slug: response.slug, locale: response.locale, collectionId },
    });
  };

  return (
    <>
      {PageHeader !== undefined && <PageHeader title={headerTitle} />}
      <FormScreenLayout
        onSubmit={() => {
          void handleCreate();
        }}
        testId="collection-entry-create"
        actions={
          canWrite ? (
            <Button
              type="submit"
              loading={submitting}
              disabled={disabled || !slugValid || title === ""}
            >
              {t("template-resolver.editor.create")}
            </Button>
          ) : undefined
        }
      >
        <Section>
          {!canWrite && <Banner variant="info">{t("template-resolver.editor.readOnly")}</Banner>}
          <Field
            id="create-entry-slug"
            label={t("template-resolver.editor.slugLabel")}
            required
            {...(slugInvalid && { issues: [SLUG_INVALID_ISSUE] })}
          >
            <Input
              kind="text"
              id="create-entry-slug"
              name="create-entry-slug"
              value={slug}
              onChange={setSlug}
              disabled={disabled}
              required
            />
          </Field>
          <Field id="create-entry-title" label={t("template-resolver.editor.titleLabel")} required>
            <Input
              kind="text"
              id="create-entry-title"
              name="create-entry-title"
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
          {error !== null && <Banner variant="error">{error}</Banner>}
        </Section>
      </FormScreenLayout>
    </>
  );
}
