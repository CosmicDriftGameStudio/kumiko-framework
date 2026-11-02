import type { TargetRef } from "@cosmicdrift/kumiko-framework/engine";
import type { FieldIssue } from "@cosmicdrift/kumiko-framework/errors";
import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { ContentWorkbench } from "./content-workbench.tsx";
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
  const { Field, Input } = usePrimitives();
  const t = useTranslation();
  return (
    <>
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
  const { Banner } = usePrimitives();
  const t = useTranslation();
  const state = useCollectionEntryCreate(target, tenantId);
  return (
    <ContentWorkbench
      testId="collection-entry-create"
      title={state.headerTitle}
      editorContext={state.editorContext}
      content={state.content}
      onContentChange={state.setContent}
      disabled={state.disabled}
      fields={<CreateFields state={state} />}
      details={[
        {
          label: t("template-resolver.editor.slugLabel"),
          value: state.slug === "" ? "–" : state.slug,
        },
      ]}
      banners={
        !state.editorContext.canWrite && (
          <Banner variant="info">{t("template-resolver.editor.readOnly")}</Banner>
        )
      }
      save={{
        busy: state.submitting,
        canSave: !state.createDisabled,
        dirty: state.slug !== "" || state.title !== "" || state.content !== "",
        onSave: () => void state.create(),
        onDiscard: state.reset,
        saveError: state.error,
        saveLabel: t("template-resolver.editor.create"),
      }}
    />
  );
}
