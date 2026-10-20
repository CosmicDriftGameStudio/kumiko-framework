import {
  PDF_ORIENTATIONS,
  PDF_PAGE_FORMATS,
  PlaceholderLineEditor,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import type { EditorVocabulary } from "./mail-edit-center.tsx";
import { languageName } from "./mail-origin-bar.tsx";
import { layoutOptionLabel } from "./mail-right-rail.tsx";
import { VersionsSection } from "./mail-versions.tsx";
import type { OverviewRowView } from "./overview-row.ts";
import { MARGIN_SIDES, type MarginSide, type PdfMetaDraft } from "./pdf-meta.ts";
import { RailField, RailHint, RailSection } from "./rail.tsx";
import { DEFAULT_LAYOUT_SLUG, type TemplateStatus } from "./types.ts";
import type { InsertTargets } from "./use-insert-targets.ts";

export type VersionInfo = {
  readonly id: string;
  readonly version: number;
  readonly status: TemplateStatus;
};

export type SettingsPanelProps = {
  readonly meta: PdfMetaDraft;
  readonly onMetaChange: (next: PdfMetaDraft) => void;
  readonly layouts: readonly OverviewRowView[];
  readonly locale: string;
  readonly version: VersionInfo;
  readonly vocabulary: EditorVocabulary;
  readonly insert: InsertTargets;
  /** Changes when the draft is replaced from outside, so the single-line editors re-read it. */
  readonly draftKey: string;
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
  layouts,
  locale,
  version,
  vocabulary,
  insert,
  draftKey,
}: SettingsPanelProps): ReactNode {
  const t = useTranslation();
  const { Field, Input, Text } = usePrimitives();
  const patch = (changes: Partial<PdfMetaDraft>): void => onMetaChange({ ...meta, ...changes });

  return (
    <div data-testid="document-designer-settings">
      <RailSection title={t("documentDesigner.settings.page")} testId="pdf-editor-document">
        <RailField>
          <Field id="dd-layout" label={t("documentDesigner.settings.layout")}>
            <Input
              kind="select"
              id="dd-layout"
              name="layoutSlug"
              value={meta.layoutSlug === "" ? DEFAULT_LAYOUT_SLUG : meta.layoutSlug}
              onChange={(layoutSlug) => patch({ layoutSlug })}
              display="dropdown"
              options={layouts.map((layout) => ({
                value: layout.slug,
                label: layoutOptionLabel(t, layout),
              }))}
            />
          </Field>
          <Field id="dd-file-name" label={t("documentDesigner.settings.fileName")}>
            <Input
              kind="text"
              id="dd-file-name"
              name="fileName"
              value={meta.fileName}
              onChange={(fileName) => patch({ fileName })}
              placeholder={t("documentDesigner.settings.fileNamePlaceholder")}
            />
          </Field>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-2">
            <Field id="dd-page-format" label={t("documentDesigner.settings.pageFormat")}>
              <Input
                kind="select"
                id="dd-page-format"
                name="pageFormat"
                value={meta.pageFormat}
                onChange={(pageFormat) => {
                  const next = PDF_PAGE_FORMATS.find((format) => format === pageFormat);
                  if (next !== undefined) patch({ pageFormat: next });
                }}
                display="dropdown"
                options={PDF_PAGE_FORMATS.map((value) => ({ value, label: value }))}
              />
            </Field>
            <Field id="dd-orientation" label={t("documentDesigner.settings.orientation")}>
              <Input
                kind="select"
                id="dd-orientation"
                name="orientation"
                value={meta.orientation}
                onChange={(orientation) => {
                  const next = PDF_ORIENTATIONS.find((candidate) => candidate === orientation);
                  if (next !== undefined) patch({ orientation: next });
                }}
                display="dropdown"
                options={PDF_ORIENTATIONS.map((value) => ({
                  value,
                  label: t(`documentDesigner.settings.${value}`),
                }))}
              />
            </Field>
          </div>
          <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
            <legend className="p-0 text-sm font-medium">
              {t("documentDesigner.settings.margins")}
            </legend>
            <div className="grid grid-cols-4 gap-1">
              {MARGIN_SIDES.map((side) => (
                <Field
                  key={side}
                  id={`dd-margin-${side}`}
                  label={t(SIDE_LABEL_KEYS[side])}
                  hideLabel
                >
                  <Input
                    kind="number"
                    id={`dd-margin-${side}`}
                    name={`margin-${side}`}
                    value={meta.margins[side]}
                    onChange={(value) =>
                      patch({ margins: { ...meta.margins, [side]: value ?? "" } })
                    }
                    placeholder="15"
                  />
                </Field>
              ))}
            </div>
          </fieldset>
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
        </RailField>
      </RailSection>

      <RailSection title={t("documentDesigner.settings.metadata")} testId="pdf-editor-metadata">
        <RailField>
          <div onFocusCapture={insert.markFocused("title")} data-testid="pdf-meta-title">
            <Field id="dd-meta-title" label={t("documentDesigner.settings.metaTitle")}>
              <PlaceholderLineEditor
                key={`title:${draftKey}`}
                id="dd-meta-title"
                value={meta.title}
                onChange={(title) => patch({ title })}
                variableLabels={vocabulary.labels}
                systemVariables={vocabulary.system}
                onEditorReady={insert.register("title")}
                aria-label={t("documentDesigner.settings.metaTitle")}
              />
            </Field>
          </div>
          <div onFocusCapture={insert.markFocused("author")} data-testid="pdf-meta-author">
            <Field id="dd-meta-author" label={t("documentDesigner.settings.metaAuthor")}>
              <PlaceholderLineEditor
                key={`author:${draftKey}`}
                id="dd-meta-author"
                value={meta.author}
                onChange={(author) => patch({ author })}
                variableLabels={vocabulary.labels}
                systemVariables={vocabulary.system}
                onEditorReady={insert.register("author")}
                aria-label={t("documentDesigner.settings.metaAuthor")}
              />
            </Field>
          </div>
          <div className="flex flex-col gap-1" data-testid="pdf-meta-language">
            <span className="text-sm font-medium">
              {t("documentDesigner.settings.metaLanguage")}
            </span>
            <Text>{`${languageName(t, locale)} (${locale})`}</Text>
          </div>
        </RailField>
        <RailHint>{t("documentDesigner.settings.metaLanguageHint")}</RailHint>
      </RailSection>

      <RailSection title={t("documentDesigner.settings.storage")} testId="pdf-editor-storage">
        <RailHint>{t("documentDesigner.settings.storageHint")}</RailHint>
      </RailSection>

      <VersionsSection
        rowId={version.id}
        currentVersion={version.version}
        currentStatus={version.status}
      />
    </div>
  );
}
