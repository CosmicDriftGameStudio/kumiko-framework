// @runtime client
import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { ModeSwitch, SectionCard, StatusBadge } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import {
  MARGIN_SIDES,
  type MarginSide,
  ORIENTATIONS,
  PAGE_FORMATS,
  type PdfMetaDraft,
} from "./pdf-meta.js";
import type { TemplateStatus } from "./types.js";

export type VersionInfo = {
  readonly version: number;
  readonly status: TemplateStatus;
  readonly modifiedAt: string | null;
};

export type SettingsPanelProps = {
  readonly meta: PdfMetaDraft;
  readonly onMetaChange: (next: PdfMetaDraft) => void;
  /** Layout slugs available for this locale; the default layout is always offered. */
  readonly layoutSlugs: readonly string[];
  readonly locale: string;
  readonly version: VersionInfo;
};

const SIDE_LABEL_KEYS: Readonly<Record<MarginSide, string>> = {
  top: "documentDesigner.settings.marginTop",
  right: "documentDesigner.settings.marginRight",
  bottom: "documentDesigner.settings.marginBottom",
  left: "documentDesigner.settings.marginLeft",
};

export function SettingsPanel({
  meta,
  onMetaChange,
  layoutSlugs,
  locale,
  version,
}: SettingsPanelProps): ReactNode {
  const t = useTranslation();
  const { Field, Input } = usePrimitives();
  const patch = (changes: Partial<PdfMetaDraft>): void => onMetaChange({ ...meta, ...changes });

  return (
    <div className="flex flex-col gap-4" data-testid="document-designer-settings">
      <SectionCard title={t("documentDesigner.settings.page")}>
        <Field id="dd-layout" label={t("documentDesigner.settings.layout")}>
          <Input
            kind="select"
            id="dd-layout"
            name="layoutSlug"
            value={meta.layoutSlug}
            onChange={(layoutSlug) => patch({ layoutSlug })}
            display="dropdown"
            options={[
              { value: "", label: t("documentDesigner.settings.layoutDefault") },
              ...layoutSlugs.map((slug) => ({ value: slug, label: slug })),
            ]}
          />
        </Field>
        <Field id="dd-file-name" label={t("documentDesigner.settings.fileName")}>
          <Input
            kind="text"
            id="dd-file-name"
            name="fileName"
            value={meta.fileName}
            onChange={(fileName) => patch({ fileName })}
            placeholder="rechnung-{{number}}.pdf"
          />
        </Field>
        <ModeSwitch
          ariaLabel={t("documentDesigner.settings.pageFormat")}
          value={meta.pageFormat}
          onChange={(pageFormat) => patch({ pageFormat })}
          options={PAGE_FORMATS.map((value) => ({ value, label: value }))}
        />
        <ModeSwitch
          ariaLabel={t("documentDesigner.settings.orientation")}
          value={meta.orientation}
          onChange={(orientation) => patch({ orientation })}
          options={ORIENTATIONS.map((value) => ({
            value,
            label: t(`documentDesigner.settings.${value}`),
          }))}
        />
        <div className="grid grid-cols-2 gap-2">
          {MARGIN_SIDES.map((side) => (
            <Field key={side} id={`dd-margin-${side}`} label={t(SIDE_LABEL_KEYS[side])}>
              <Input
                kind="number"
                id={`dd-margin-${side}`}
                name={`margin-${side}`}
                value={meta.margins[side]}
                onChange={(value) => patch({ margins: { ...meta.margins, [side]: value ?? "" } })}
                placeholder="15"
              />
            </Field>
          ))}
        </div>
        <Field
          id="dd-print-background"
          label={t("documentDesigner.settings.printBackground")}
          layout="inline"
        >
          <Input
            kind="boolean"
            id="dd-print-background"
            name="printBackground"
            value={meta.printBackground}
            onChange={(printBackground) => patch({ printBackground })}
          />
        </Field>
        <Field
          id="dd-layout-header-footer"
          label={t("documentDesigner.settings.layoutHeaderFooter")}
          layout="inline"
        >
          <Input
            kind="boolean"
            id="dd-layout-header-footer"
            name="layoutHeaderFooter"
            value={meta.layoutHeaderFooter}
            onChange={(layoutHeaderFooter) => patch({ layoutHeaderFooter })}
          />
        </Field>
      </SectionCard>

      <SectionCard title={t("documentDesigner.settings.metadata")}>
        <Field id="dd-meta-title" label={t("documentDesigner.settings.metaTitle")}>
          <Input
            kind="text"
            id="dd-meta-title"
            name="metaTitle"
            value={meta.title}
            onChange={(title) => patch({ title })}
          />
        </Field>
        <Field id="dd-meta-author" label={t("documentDesigner.settings.metaAuthor")}>
          <Input
            kind="text"
            id="dd-meta-author"
            name="metaAuthor"
            value={meta.author}
            onChange={(author) => patch({ author })}
          />
        </Field>
        <Field id="dd-meta-language" label={t("documentDesigner.settings.metaLanguage")}>
          <Input
            kind="text"
            id="dd-meta-language"
            name="metaLanguage"
            value={locale}
            onChange={() => undefined}
            disabled
          />
        </Field>
      </SectionCard>

      <SectionCard title={t("documentDesigner.settings.storage")}>
        <p className="text-xs text-muted-foreground">
          {t("documentDesigner.settings.storageHint")}
        </p>
      </SectionCard>

      <SectionCard title={t("documentDesigner.settings.versions")}>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>{`v${version.version}`}</span>
          <span className="text-xs text-muted-foreground">
            {version.modifiedAt?.slice(0, 10) ?? ""}
          </span>
          <StatusBadge tone={version.status === "active" ? "ok" : "warn"}>
            {t(
              version.status === "active"
                ? "documentDesigner.status.active"
                : "documentDesigner.status.draft",
            )}
          </StatusBadge>
        </div>
      </SectionCard>
    </div>
  );
}
