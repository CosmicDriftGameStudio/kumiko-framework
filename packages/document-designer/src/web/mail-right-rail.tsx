// @runtime client
import { TemplateResolverQueries } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { usePrimitives, useQuery, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { DEFAULT_LAYOUT_SLUG } from "../constants.js";
import type { LinkedResourceView, MailCategory, MailDraft } from "./mail-types.js";
import type { OverviewRowView } from "./overview-row.js";
import { RailHint, RailRow, RailSection } from "./rail.js";
import { usageParts } from "./used-by-label.js";

type Usage = { readonly feature: string; readonly notification: string };

export function layoutOptionLabel(
  t: (key: string, params?: Readonly<Record<string, unknown>>) => string,
  layout: OverviewRowView,
): string {
  return t(
    layout.origin === "tenant"
      ? "documentDesigner.mail.props.layoutTenant"
      : "documentDesigner.mail.props.layoutSystem",
    { title: layout.title, version: layout.version },
  );
}

function UsageRows({ slug }: { readonly slug: string }): ReactNode {
  const t = useTranslation();
  const { data } = useQuery<{ readonly usedBy: readonly Usage[] }>(TemplateResolverQueries.usage, {
    slug,
    kind: "mail",
  });
  return (
    <>
      {(data?.usedBy ?? []).map((usage) => {
        const parts = usageParts(t, usage);
        return (
          <RailRow
            key={`${usage.feature}:${usage.notification}`}
            label={t("documentDesigner.mail.usage.line", parts)}
            testId="mail-usage-row"
          />
        );
      })}
    </>
  );
}

export function AttachmentSection({
  attachments,
  pdfTitles,
  canEdit,
  onAddPdf,
  onRemove,
}: {
  readonly attachments: readonly LinkedResourceView[];
  readonly pdfTitles: ReadonlyMap<string, string>;
  readonly canEdit: boolean;
  readonly onAddPdf: () => void;
  readonly onRemove: (key: string) => void;
}): ReactNode {
  const t = useTranslation();
  const { Button } = usePrimitives();
  return (
    <RailSection
      title={t("documentDesigner.mail.attachments.title")}
      testId="mail-editor-attachments"
      action={
        <Button
          variant="link"
          disabled={!canEdit}
          onClick={onAddPdf}
          testId="mail-attachment-pdf-open"
        >
          {t("documentDesigner.mail.attachments.addPdf")}
        </Button>
      }
    >
      {attachments.length === 0 && (
        <RailHint>{t("documentDesigner.mail.attachments.none")}</RailHint>
      )}
      {attachments.map((attachment) => (
        <div
          key={attachment.key}
          className="flex items-center gap-1"
          data-testid="mail-attachment-row"
        >
          <div className="min-w-0 grow">
            {attachment.kind === "pdf" ? (
              <RailRow
                symbol="⎘"
                label={t("documentDesigner.mail.attachments.pdfRow", {
                  title: pdfTitles.get(attachment.templateSlug) ?? attachment.templateSlug,
                })}
                trailing={attachment.fileName}
              />
            ) : (
              <RailRow
                symbol="⎘"
                label={attachment.kind === "file" ? attachment.fileName : attachment.key}
                trailing={t("documentDesigner.mail.attachments.file")}
              />
            )}
          </div>
          <Button
            variant="danger-ghost"
            size="sm"
            onClick={() => onRemove(attachment.key)}
            testId={`mail-attachment-remove-${attachment.key}`}
          >
            {t("documentDesigner.mail.resource.remove")}
          </Button>
        </div>
      ))}
    </RailSection>
  );
}

export function PropertiesSection({
  draft,
  layouts,
  onChange,
}: {
  readonly draft: MailDraft;
  readonly layouts: readonly OverviewRowView[];
  readonly onChange: (patch: Partial<MailDraft>) => void;
}): ReactNode {
  const t = useTranslation();
  const { Field, Input, Text } = usePrimitives();
  const layoutValue = draft.layoutSlug === "" ? DEFAULT_LAYOUT_SLUG : draft.layoutSlug;
  const categoryValue: MailCategory = draft.category === "" ? "transactional" : draft.category;
  return (
    <RailSection title={t("documentDesigner.mail.props.title")} testId="mail-editor-properties">
      <div className="flex flex-col gap-3 px-2">
        <Field id="mail-layout" label={t("documentDesigner.mail.props.layout")}>
          <Input
            kind="select"
            id="mail-layout"
            name="mail-layout"
            value={layoutValue}
            onChange={(next) => onChange({ layoutSlug: next })}
            options={layouts.map((layout) => ({
              value: layout.slug,
              label: layoutOptionLabel(t, layout),
            }))}
          />
        </Field>
        <Field id="mail-sender" label={t("documentDesigner.mail.props.sender")}>
          <Text testId="mail-sender">{t("documentDesigner.mail.props.senderDefault")}</Text>
        </Field>
        <Field id="mail-category" label={t("documentDesigner.mail.props.category")}>
          <Input
            kind="select"
            id="mail-category"
            name="mail-category"
            value={categoryValue}
            onChange={(next) =>
              onChange({ category: next === "marketing" ? "marketing" : "transactional" })
            }
            options={[
              { value: "transactional", label: t("documentDesigner.mail.props.transactional") },
              { value: "marketing", label: t("documentDesigner.mail.props.marketing") },
            ]}
          />
        </Field>
      </div>
      <RailHint>{t("documentDesigner.mail.props.categoryHint")}</RailHint>
    </RailSection>
  );
}

export function UsageSection({ slug }: { readonly slug: string }): ReactNode {
  const t = useTranslation();
  return (
    <RailSection title={t("documentDesigner.mail.usage.title")} testId="mail-editor-usage">
      <UsageRows slug={slug} />
      <RailHint>{t("documentDesigner.mail.usage.hint")}</RailHint>
    </RailSection>
  );
}
