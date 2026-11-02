import type { TargetRef } from "@cosmicdrift/kumiko-framework/engine";
import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { ContentWorkbench } from "./content-workbench.tsx";
import { useTextBlockEditor } from "./use-text-block-editor.ts";

type EditorState = ReturnType<typeof useTextBlockEditor>;

function LoadBanners({ state }: { readonly state: EditorState }): ReactNode {
  const { Banner } = usePrimitives();
  const t = useTranslation();
  return (
    <>
      {state.loading && <Banner variant="loading">{t("template-resolver.editor.loading")}</Banner>}
      {state.loadError !== null && (
        <Banner variant="error">
          {t("template-resolver.editor.loadFailed")}: {state.loadError.code}
        </Banner>
      )}
      {!state.canWrite && !state.loading && (
        <Banner variant="info">{t("template-resolver.editor.readOnly")}</Banner>
      )}
      {state.savedMsg !== null && <Banner variant="info">{state.savedMsg}</Banner>}
    </>
  );
}

export function TextBlockEditor({
  target,
}: {
  readonly target: TargetRef;
  // onClose stays part of the resolver contract (the visual panel passes it)
  // but is unused: tree selection navigates, there is no close button.
  readonly onClose: () => void;
}): ReactNode {
  const { Field, Input } = usePrimitives();
  const t = useTranslation();
  const state = useTextBlockEditor(target);
  const headerTitle = state.title || state.slug || undefined;

  return (
    <ContentWorkbench
      testId="text-block-editor"
      title={headerTitle ?? t("template-resolver.editor.titleLabel")}
      editorContext={state.editorContext}
      content={state.content}
      onContentChange={state.setContent}
      disabled={state.disabled}
      banners={<LoadBanners state={state} />}
      details={[
        { label: t("template-resolver.editor.slugLabel"), value: state.slug },
        ...(state.locale !== ""
          ? [{ label: t("template-resolver.editor.localeLabel"), value: state.locale }]
          : []),
      ]}
      fields={
        <Field id="text-block-title" label={t("template-resolver.editor.titleLabel")} required>
          <Input
            kind="text"
            id="text-block-title"
            name="text-block-title"
            value={state.title}
            onChange={state.setTitle}
            disabled={state.disabled}
            required
          />
        </Field>
      }
      save={{
        busy: state.submitting,
        canSave: state.dirty && !state.disabled,
        dirty: state.dirty,
        onSave: () => void state.save(),
        onDiscard: state.discard,
        saveError: state.saveError,
        modifiedAt: state.modifiedAt,
      }}
    />
  );
}
