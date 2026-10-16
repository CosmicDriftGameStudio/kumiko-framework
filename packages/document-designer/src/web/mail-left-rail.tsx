// @runtime client
import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { PLACEHOLDER_SYMBOL } from "./mail-draft.js";
import type { LinkedResourceView, MailValidation } from "./mail-types.js";
import { RailHint, RailRow, RailSection } from "./rail.js";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

function placeholderStatus(t: Translate, validation: MailValidation, name: string): string {
  if (validation.missingRequired.includes(name))
    return t("documentDesigner.mail.placeholder.missing");
  return validation.used.includes(name) ? "✓" : "–";
}

export function PlaceholderSection({
  validation,
  onInsert,
}: {
  readonly validation: MailValidation | null;
  readonly onInsert: (name: string) => void;
}): ReactNode {
  const t = useTranslation();
  const entries = Object.entries(validation?.variables ?? {});
  return (
    <RailSection
      title={t("documentDesigner.mail.placeholder.title")}
      testId="mail-editor-placeholders"
    >
      {validation !== null &&
        entries.map(([name, variable]) => (
          <RailRow
            key={name}
            testId={`mail-placeholder-${name}`}
            symbol={PLACEHOLDER_SYMBOL[variable.type]}
            label={`${variable.label ?? name}${variable.required === true ? " *" : ""}`}
            bad={validation.missingRequired.includes(name)}
            trailing={placeholderStatus(t, validation, name)}
            onPress={() => onInsert(name)}
          />
        ))}
      <RailHint>{t("documentDesigner.mail.placeholder.hint")}</RailHint>
    </RailSection>
  );
}

function systemLabel(t: Translate, name: string): string {
  const key = `documentDesigner.placeholder.${name}`;
  const translated = t(key);
  return translated === key ? name : translated;
}

export function SystemPlaceholderSection({
  validation,
  onInsert,
}: {
  readonly validation: MailValidation | null;
  readonly onInsert: (name: string) => void;
}): ReactNode {
  const t = useTranslation();
  return (
    <RailSection
      title={t("documentDesigner.mail.system.title")}
      testId="mail-editor-system-placeholders"
    >
      {(validation?.systemPlaceholders ?? []).map((name) => (
        <RailRow
          key={name}
          testId={`mail-system-${name}`}
          label={systemLabel(t, name)}
          trailing={validation?.used.includes(name) === true ? "✓" : "–"}
          onPress={() => onInsert(name)}
        />
      ))}
    </RailSection>
  );
}

function resourceRow(
  t: Translate,
  resource: LinkedResourceView,
  pdfTitles: ReadonlyMap<string, string>,
): { readonly symbol: string; readonly label: string; readonly meta: string } {
  switch (resource.kind) {
    case "image":
      return { symbol: "▣", label: resource.key, meta: t("documentDesigner.mail.resource.inline") };
    case "file":
      return {
        symbol: "⎘",
        label: resource.fileName,
        meta: t("documentDesigner.mail.resource.attachment"),
      };
    case "pdf":
      return {
        symbol: "⎘",
        label: resource.fileName,
        meta: t("documentDesigner.mail.resource.fromPdf", {
          title: pdfTitles.get(resource.templateSlug) ?? resource.templateSlug,
        }),
      };
  }
}

export function ResourceSection({
  resources,
  pdfTitles,
  canUpload,
  onUpload,
  onInsert,
  onRemove,
}: {
  readonly resources: readonly LinkedResourceView[];
  readonly pdfTitles: ReadonlyMap<string, string>;
  readonly canUpload: boolean;
  readonly onUpload: () => void;
  readonly onInsert: (key: string) => void;
  readonly onRemove: (key: string) => void;
}): ReactNode {
  const t = useTranslation();
  const { Button } = usePrimitives();
  return (
    <RailSection
      title={t("documentDesigner.mail.resource.title")}
      testId="mail-editor-resources"
      action={
        <Button
          variant="link"
          disabled={!canUpload}
          onClick={onUpload}
          testId="mail-resource-upload-open"
        >
          {t("documentDesigner.mail.resource.upload")}
        </Button>
      }
    >
      {!canUpload && <RailHint>{t("documentDesigner.mail.resource.saveFirst")}</RailHint>}
      {resources.map((resource) => {
        const row = resourceRow(t, resource, pdfTitles);
        return (
          <div
            key={resource.key}
            className="flex items-center gap-1"
            data-testid="mail-resource-row"
          >
            <div className="min-w-0 grow">
              <RailRow
                symbol={row.symbol}
                label={row.label}
                trailing={row.meta}
                {...(resource.kind === "image" && { onPress: () => onInsert(resource.key) })}
              />
            </div>
            <Button
              variant="danger-ghost"
              size="sm"
              onClick={() => onRemove(resource.key)}
              testId={`mail-resource-remove-${resource.key}`}
            >
              {t("documentDesigner.mail.resource.remove")}
            </Button>
          </div>
        );
      })}
      <RailHint>{t("documentDesigner.mail.resource.hint")}</RailHint>
    </RailSection>
  );
}
