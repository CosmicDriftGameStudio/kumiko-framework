// @runtime client
import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import {
  LAYOUT_OWNED_PLACEHOLDERS,
  PLACEHOLDER_SYMBOL,
  SYSTEM_PLACEHOLDER_TYPE,
  systemPlaceholderLabel,
} from "./mail-draft.ts";
import type { LinkedResourceView, MailValidation } from "./mail-types.ts";
import { RailHint, RailRow, RailSection } from "./rail.tsx";
import { variableLabelText } from "./used-by-label.ts";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

// What both editors' validation results share; the PDF validation fits it structurally.
export type PlaceholderSource = Pick<
  MailValidation,
  "variables" | "used" | "missingRequired" | "systemPlaceholders"
>;

function placeholderStatus(
  t: Translate,
  validation: PlaceholderSource,
  name: string,
): { readonly text: string; readonly tone: "ok" | "bad" | "muted" } {
  if (validation.missingRequired.includes(name)) {
    return { text: t("documentDesigner.mail.placeholder.missing"), tone: "bad" };
  }
  return validation.used.includes(name) ? { text: "✓", tone: "ok" } : { text: "–", tone: "muted" };
}

export function PlaceholderSection({
  validation,
  onInsert,
  idPrefix = "mail",
}: {
  readonly validation: PlaceholderSource | null;
  readonly onInsert: (name: string) => void;
  readonly idPrefix?: string;
}): ReactNode {
  const t = useTranslation();
  const entries = Object.entries(validation?.variables ?? {});
  return (
    <RailSection
      title={t("documentDesigner.mail.placeholder.title")}
      testId={`${idPrefix}-editor-placeholders`}
    >
      {validation !== null &&
        entries.map(([name, variable]) => {
          const status = placeholderStatus(t, validation, name);
          return (
            <RailRow
              key={name}
              testId={`${idPrefix}-placeholder-${name}`}
              symbol={PLACEHOLDER_SYMBOL[variable.type]}
              label={variableLabelText(t, name, variable.label)}
              nameHint={name}
              required={variable.required === true}
              bad={validation.missingRequired.includes(name)}
              trailing={status.text}
              trailingTone={status.tone}
              onPress={() => onInsert(name)}
            />
          );
        })}
      <RailHint>{t("documentDesigner.mail.placeholder.hint")}</RailHint>
    </RailSection>
  );
}

export function SystemPlaceholderSection({
  validation,
  onInsert,
  idPrefix = "mail",
  isLayoutOwned = (name) => LAYOUT_OWNED_PLACEHOLDERS.has(name),
}: {
  readonly validation: PlaceholderSource | null;
  readonly onInsert: (name: string) => void;
  readonly idPrefix?: string;
  /** Placeholders the layout fills in, so a template that never uses them is fine. */
  readonly isLayoutOwned?: (name: string) => boolean;
}): ReactNode {
  const t = useTranslation();
  return (
    <RailSection
      title={t("documentDesigner.mail.system.title")}
      testId={`${idPrefix}-editor-system-placeholders`}
    >
      {(validation?.systemPlaceholders ?? []).map((name) => {
        const used = validation?.used.includes(name) === true;
        const layoutOwned = !used && isLayoutOwned(name);
        return (
          <RailRow
            key={name}
            testId={`${idPrefix}-system-${name}`}
            symbol={PLACEHOLDER_SYMBOL[SYSTEM_PLACEHOLDER_TYPE[name] ?? "text"]}
            label={systemPlaceholderLabel(t, name)}
            trailing={used ? "✓" : layoutOwned ? t("documentDesigner.mail.system.layout") : "–"}
            trailingTone={used ? "ok" : "muted"}
            onPress={() => onInsert(name)}
          />
        );
      })}
      <RailHint>{t("documentDesigner.mail.system.hint")}</RailHint>
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
  filesAvailable,
  onUpload,
  onInsert,
  onRemove,
}: {
  readonly resources: readonly LinkedResourceView[];
  readonly pdfTitles: ReadonlyMap<string, string>;
  readonly canUpload: boolean;
  readonly filesAvailable: boolean;
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
          disabled={!canUpload || !filesAvailable}
          onClick={onUpload}
          testId="mail-resource-upload-open"
        >
          {t("documentDesigner.mail.resource.upload")}
        </Button>
      }
    >
      {!filesAvailable && <RailHint>{t("documentDesigner.mail.resource.noFilesFeature")}</RailHint>}
      {filesAvailable && !canUpload && (
        <RailHint>{t("documentDesigner.mail.resource.saveFirst")}</RailHint>
      )}
      {resources.map((resource) => {
        const row = resourceRow(t, resource, pdfTitles);
        return (
          <RailRow
            key={resource.key}
            testId="mail-resource-row"
            symbol={row.symbol}
            label={row.label}
            trailing={row.meta}
            action={
              <Button
                variant="danger-ghost"
                size="sm"
                onClick={() => onRemove(resource.key)}
                testId={`mail-resource-remove-${resource.key}`}
              >
                {t("documentDesigner.mail.resource.remove")}
              </Button>
            }
            {...(resource.kind === "image" && { onPress: () => onInsert(resource.key) })}
          />
        );
      })}
      <RailHint>{t("documentDesigner.mail.resource.hint")}</RailHint>
    </RailSection>
  );
}
