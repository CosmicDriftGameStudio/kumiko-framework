import type { TargetRef } from "@cosmicdrift/kumiko-framework/engine";
import { FormScreenLayout, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { ContentField } from "./content-field.tsx";
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
    </>
  );
}

function SaveBanners({ state }: { readonly state: EditorState }): ReactNode {
  const { Banner } = usePrimitives();
  return (
    <>
      {state.saveError !== null && <Banner variant="error">{state.saveError}</Banner>}
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
  const { Button, Field, Input, PageHeader, Section } = usePrimitives();
  const t = useTranslation();
  const state = useTextBlockEditor(target);
  const headerTitle = state.title || state.slug || undefined;

  return (
    <>
      {/* The editor opens beside the routed screen, so without this the shell header keeps that screen's title. */}
      {PageHeader !== undefined && headerTitle !== undefined && <PageHeader title={headerTitle} />}
      <FormScreenLayout
        onSubmit={() => {
          void state.save();
        }}
        testId="text-block-editor"
        description={state.locale !== "" ? `${state.slug} · (${state.locale})` : state.slug}
        actions={
          state.canWrite ? (
            <Button type="submit" loading={state.submitting} disabled={state.disabled}>
              {t(state.saveLabelKey)}
            </Button>
          ) : undefined
        }
      >
        <Section>
          <LoadBanners state={state} />
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
          <ContentField
            editorContext={state.editorContext}
            value={state.content}
            onChange={state.setContent}
            disabled={state.disabled}
          />
          <SaveBanners state={state} />
        </Section>
      </FormScreenLayout>
    </>
  );
}
