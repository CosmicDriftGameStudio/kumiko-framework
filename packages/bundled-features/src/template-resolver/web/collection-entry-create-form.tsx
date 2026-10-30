import type { TargetRef } from "@cosmicdrift/kumiko-framework/engine";
import type { FieldIssue } from "@cosmicdrift/kumiko-framework/errors";
import { FormScreenLayout, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { ContentField } from "./content-field.tsx";
import { useCollectionEntryCreate } from "./use-collection-entry-create.ts";

const SLUG_INVALID_ISSUE: FieldIssue = {
  path: "slug",
  code: "slug_invalid",
  i18nKey: "template-resolver.editor.slugInvalid",
};

// A new entry in the app's own locale; the tree then lists it under that locale like any other.
// `tenantId` is the plugin's SystemAdmin tenant, the one the collection tree lists, so a new entry
// lands where the tree looks. Same rule as the tree: per-user collections stay on the session tenant.
export function createCollectionEntryCreateForm(
  tenantId: string | undefined,
): (props: { readonly target: TargetRef; readonly onClose: () => void }) => ReactNode {
  // biome-ignore lint/correctness/noComponentHookFactories: setup-time factory, called once per templateResolverClient(); the resolver slot only passes target/onClose, so tenantId is bound here
  return function BoundCollectionEntryCreateForm(props) {
    return <CollectionEntryCreateForm {...props} tenantId={tenantId} />;
  };
}

type CreateState = ReturnType<typeof useCollectionEntryCreate>;

function CreateFields({ state }: { readonly state: CreateState }): ReactNode {
  const { Field, Input, Banner } = usePrimitives();
  const t = useTranslation();
  const { canWrite } = state.editorContext;
  return (
    <>
      {!canWrite && <Banner variant="info">{t("template-resolver.editor.readOnly")}</Banner>}
      <Field
        id="create-entry-slug"
        label={t("template-resolver.editor.slugLabel")}
        required
        {...(state.slugInvalid && { issues: [SLUG_INVALID_ISSUE] })}
      >
        <Input
          kind="text"
          id="create-entry-slug"
          name="create-entry-slug"
          value={state.slug}
          onChange={state.setSlug}
          disabled={state.disabled}
          required
        />
      </Field>
      <Field id="create-entry-title" label={t("template-resolver.editor.titleLabel")} required>
        <Input
          kind="text"
          id="create-entry-title"
          name="create-entry-title"
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
      {state.error !== null && <Banner variant="error">{state.error}</Banner>}
    </>
  );
}

export function CollectionEntryCreateForm({
  target,
  tenantId,
}: {
  readonly target: TargetRef;
  readonly onClose: () => void;
  readonly tenantId?: string | undefined;
}): ReactNode {
  const { Button, PageHeader, Section } = usePrimitives();
  const t = useTranslation();
  const state = useCollectionEntryCreate(target, tenantId);
  return (
    <>
      {PageHeader !== undefined && <PageHeader title={state.headerTitle} />}
      <FormScreenLayout
        onSubmit={() => {
          void state.create();
        }}
        testId="collection-entry-create"
        actions={
          state.editorContext.canWrite ? (
            <Button type="submit" loading={state.submitting} disabled={state.createDisabled}>
              {t("template-resolver.editor.create")}
            </Button>
          ) : undefined
        }
      >
        <Section>
          <CreateFields state={state} />
        </Section>
      </FormScreenLayout>
    </>
  );
}
