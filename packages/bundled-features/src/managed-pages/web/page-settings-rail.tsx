import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { RailField, RailRow, RailSection } from "@cosmicdrift/kumiko-renderer/web";
import type { ReactNode } from "react";
import type { PageDraft } from "./page-edit-draft.ts";

export function PageSettingsFields({
  draft,
  onPatch: patch,
  testId,
}: {
  readonly draft: PageDraft;
  readonly onPatch: (changes: Partial<PageDraft>) => void;
  readonly testId: string;
}): ReactNode {
  const t = useTranslation();
  const { Field, Input } = usePrimitives();
  return (
    <RailSection title={t("managed-pages:editor.railPage")} testId={testId}>
      <RailField>
        <Field id="page-slug" label={t("managed-pages:entity:page:field:slug")} required>
          <Input
            kind="text"
            id="page-slug"
            name="slug"
            value={draft.slug}
            onChange={(slug) => patch({ slug })}
            required
          />
        </Field>
        <Field id="page-lang" label={t("managed-pages:entity:page:field:lang")} required>
          <Input
            kind="text"
            id="page-lang"
            name="lang"
            value={draft.lang}
            onChange={(lang) => patch({ lang })}
            required
          />
        </Field>
        <Field id="page-title" label={t("managed-pages:entity:page:field:title")} required>
          <Input
            kind="text"
            id="page-title"
            name="title"
            value={draft.title}
            onChange={(next) => patch({ title: next })}
            required
          />
        </Field>
        <Field id="page-description" label={t("managed-pages:entity:page:field:description")}>
          <Input
            kind="textarea"
            id="page-description"
            name="description"
            rows={3}
            value={draft.description}
            onChange={(description) => patch({ description })}
          />
        </Field>
        <Field id="page-og-image" label={t("managed-pages:entity:page:field:ogImage")}>
          <Input
            kind="text"
            id="page-og-image"
            name="ogImage"
            value={draft.ogImage}
            onChange={(ogImage) => patch({ ogImage })}
          />
        </Field>
        <Field id="page-published" label={t("managed-pages:entity:page:field:published")}>
          <Input
            kind="boolean"
            id="page-published"
            name="published"
            value={draft.published}
            onChange={(published) => patch({ published })}
          />
        </Field>
      </RailField>
    </RailSection>
  );
}

export function PageSettingsSummary({
  draft,
  testId,
}: {
  readonly draft: PageDraft;
  readonly testId: string;
}): ReactNode {
  const t = useTranslation();
  const missing = t("managed-pages:editor.noValue");
  const publishedLabel = t(
    `managed-pages:entity:page:field:published:option:${draft.published ? "true" : "false"}`,
  );
  return (
    <RailSection title={t("managed-pages:editor.railPage")} testId={testId}>
      <RailRow
        label={t("managed-pages:entity:page:field:slug")}
        trailing={draft.slug === "" ? missing : `/${draft.slug}`}
      />
      <RailRow label={t("managed-pages:entity:page:field:lang")} trailing={draft.lang} />
      <RailRow
        label={t("managed-pages:entity:page:field:title")}
        trailing={draft.title === "" ? missing : draft.title}
      />
      <RailRow
        label={t("managed-pages:entity:page:field:description")}
        trailing={draft.description === "" ? missing : draft.description}
      />
      <RailRow
        label={t("managed-pages:entity:page:field:ogImage")}
        trailing={draft.ogImage === "" ? missing : draft.ogImage}
      />
      <RailRow label={t("managed-pages:entity:page:field:published")} trailing={publishedLabel} />
    </RailSection>
  );
}
