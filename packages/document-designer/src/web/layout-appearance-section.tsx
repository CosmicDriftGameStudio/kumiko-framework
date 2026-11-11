import {
  DOCUMENT_FONT_LABELS,
  DOCUMENT_FONTS,
  FONT_SIZES_PT,
  PDF_FOLD_MARKS,
  PDF_TABLE_STYLES,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useLocale, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { isHexColor, PDF_LAYOUT_FONT_SIZE_RANGE, type PdfLayoutLook } from "./layout-meta.ts";
import { ColorSwatch } from "./layout-rails.tsx";
import { EMPTY_MARGIN_INPUT, resolveMarginsMm } from "./paper-geometry.ts";
import { MARGIN_SIDES, type MarginSide } from "./pdf-meta.ts";
import { RailField, RailHint, RailSection } from "./rail.tsx";

const MARGIN_LABEL_KEYS: Readonly<Record<MarginSide, string>> = {
  top: "documentDesigner.margins.top",
  right: "documentDesigner.margins.right",
  bottom: "documentDesigner.margins.bottom",
  left: "documentDesigner.margins.left",
};

function fontSizeChoices(current: number | ""): readonly number[] {
  const { min, max } = PDF_LAYOUT_FONT_SIZE_RANGE;
  const inRange: readonly number[] = FONT_SIZES_PT.filter((size) => size >= min && size <= max);
  return current === "" || inRange.includes(current)
    ? inRange
    : [...inRange, current].sort((a, b) => a - b);
}

export function LayoutAppearanceSection({
  look,
  hasHeader,
  hasFooter,
  onChange,
}: {
  readonly look: PdfLayoutLook;
  readonly hasHeader: boolean;
  readonly hasFooter: boolean;
  readonly onChange: (next: PdfLayoutLook) => void;
}): ReactNode {
  const defaultMargins = resolveMarginsMm({
    template: EMPTY_MARGIN_INPUT,
    layout: {},
    hasHeader,
    hasFooter,
  });
  const t = useTranslation();
  const { Button, Field, Input } = usePrimitives();
  const locale = useLocale().locale();
  const patch = (changes: Partial<PdfLayoutLook>): void => onChange({ ...look, ...changes });
  const paperColorInvalid = look.paperColor !== "" && !isHexColor(look.paperColor);
  const textColorInvalid = !isHexColor(look.textColor);
  const lineInvalid = look.tableLineColor !== "" && !isHexColor(look.tableLineColor);
  const headerInvalid =
    look.tableHeaderBackground !== "" && !isHexColor(look.tableHeaderBackground);

  return (
    <RailSection title={t("documentDesigner.appearance.pdfTitle")} testId="layout-appearance">
      <RailField>
        <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-2">
          <div data-testid="layout-font">
            <Field id="dd-layout-pdf-font" label={t("documentDesigner.appearance.font")}>
              <Input
                kind="select"
                id="dd-layout-pdf-font"
                name="fontFamily"
                value={look.fontFamily}
                onChange={(value) => {
                  const fontFamily = DOCUMENT_FONTS.find((candidate) => candidate === value);
                  if (fontFamily !== undefined) patch({ fontFamily });
                }}
                display="dropdown"
                options={DOCUMENT_FONTS.map((font) => ({
                  value: font,
                  label: DOCUMENT_FONT_LABELS[font],
                }))}
              />
            </Field>
          </div>
          <div data-testid="layout-font-size">
            <Field id="dd-layout-pdf-font-size" label={t("documentDesigner.appearance.fontSizePt")}>
              <Input
                kind="select"
                id="dd-layout-pdf-font-size"
                name="fontSizePt"
                value={String(look.fontSizePt)}
                onChange={(value) => patch({ fontSizePt: Number(value) })}
                display="dropdown"
                options={fontSizeChoices(look.fontSizePt).map((size) => ({
                  value: String(size),
                  label: t("documentDesigner.editor.defaultSize", {
                    value: new Intl.NumberFormat(locale).format(size),
                  }),
                }))}
              />
            </Field>
          </div>
        </div>
        <Field id="dd-layout-pdf-text-color" label={t("documentDesigner.appearance.textColor")}>
          <div className={`relative${textColorInvalid ? "" : " [&_input]:pl-8"}`}>
            {!textColorInvalid && (
              <span className="pointer-events-none absolute inset-y-0 left-2.5 z-10 flex items-center">
                <ColorSwatch color={look.textColor} />
              </span>
            )}
            <Input
              kind="text"
              id="dd-layout-pdf-text-color"
              name="textColor"
              value={look.textColor}
              onChange={(textColor) => patch({ textColor })}
              hasError={textColorInvalid}
              testId="layout-text-color"
            />
          </div>
        </Field>
        <div data-testid="layout-table-style">
          <Field id="dd-layout-pdf-table-style" label={t("documentDesigner.appearance.tableStyle")}>
            <Input
              kind="select"
              id="dd-layout-pdf-table-style"
              name="tableStyle"
              value={look.tableStyle}
              onChange={(value) => {
                const tableStyle = PDF_TABLE_STYLES.find((candidate) => candidate === value);
                if (tableStyle !== undefined) patch({ tableStyle });
              }}
              display="dropdown"
              options={PDF_TABLE_STYLES.map((style) => ({
                value: style,
                label: t(`documentDesigner.appearance.tableStyle.${style}`),
              }))}
            />
          </Field>
        </div>
        {look.tableHeaderBackground !== "" && (
          <Field
            id="dd-layout-pdf-table-header"
            label={t("documentDesigner.appearance.tableHeader")}
          >
            <div className="flex items-center gap-2">
              {!headerInvalid && <ColorSwatch color={look.tableHeaderBackground} />}
              <Input
                kind="text"
                id="dd-layout-pdf-table-header"
                name="tableHeaderBackground"
                value={look.tableHeaderBackground}
                onChange={(tableHeaderBackground) => patch({ tableHeaderBackground })}
                hasError={headerInvalid}
                placeholder="#e5e5e5"
                testId="layout-table-header"
              />
            </div>
          </Field>
        )}
        <Field id="dd-layout-pdf-table-line" label={t("documentDesigner.appearance.tableLine")}>
          <div className="flex items-center gap-2">
            {look.tableLineColor !== "" && !lineInvalid && (
              <ColorSwatch color={look.tableLineColor} />
            )}
            <Input
              kind="text"
              id="dd-layout-pdf-table-line"
              name="tableLineColor"
              value={look.tableLineColor}
              onChange={(tableLineColor) => patch({ tableLineColor })}
              hasError={lineInvalid}
              placeholder="#bbbbbb"
              testId="layout-table-line"
            />
          </div>
        </Field>
        <Field id="dd-layout-pdf-paper-color" label={t("documentDesigner.appearance.paperColor")}>
          <div className="flex items-center gap-2">
            {look.paperColor !== "" && !paperColorInvalid && (
              <ColorSwatch color={look.paperColor} />
            )}
            <Input
              kind="text"
              id="dd-layout-pdf-paper-color"
              name="paperColor"
              value={look.paperColor}
              onChange={(paperColor) => patch({ paperColor })}
              hasError={paperColorInvalid}
              placeholder="#ffffff"
              testId="layout-paper-color"
            />
            {look.paperColor !== "" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => patch({ paperColor: "" })}
                testId="layout-paper-color-reset"
              >
                {t("documentDesigner.appearance.paperColorReset")}
              </Button>
            )}
          </div>
        </Field>
        <div data-testid="layout-fold-marks">
          <Field id="dd-layout-pdf-fold-marks" label={t("documentDesigner.appearance.foldMarks")}>
            <Input
              kind="select"
              id="dd-layout-pdf-fold-marks"
              name="foldMarks"
              value={look.foldMarks}
              onChange={(value) => {
                const foldMarks = PDF_FOLD_MARKS.find((candidate) => candidate === value);
                if (foldMarks !== undefined) patch({ foldMarks });
              }}
              display="dropdown"
              options={PDF_FOLD_MARKS.map((marks) => ({
                value: marks,
                label: t(`documentDesigner.appearance.foldMarks.${marks}`),
              }))}
            />
          </Field>
        </div>
        <Field
          id="dd-layout-pdf-corner-marks"
          layout="inline"
          label={t("documentDesigner.appearance.cornerMarks")}
        >
          <Input
            kind="boolean"
            id="dd-layout-pdf-corner-marks"
            name="cornerMarks"
            value={look.cornerMarks}
            onChange={(cornerMarks) => patch({ cornerMarks })}
          />
        </Field>
        <Field
          id="dd-layout-pdf-header-first"
          layout="inline"
          label={t("documentDesigner.appearance.headerOnFirstPage")}
        >
          <Input
            kind="boolean"
            id="dd-layout-pdf-header-first"
            name="headerOnFirstPage"
            value={look.headerOnFirstPage}
            onChange={(headerOnFirstPage) => patch({ headerOnFirstPage })}
          />
        </Field>
        <Field
          id="dd-layout-pdf-footer-first"
          layout="inline"
          label={t("documentDesigner.appearance.footerOnFirstPage")}
        >
          <Input
            kind="boolean"
            id="dd-layout-pdf-footer-first"
            name="footerOnFirstPage"
            value={look.footerOnFirstPage}
            onChange={(footerOnFirstPage) => patch({ footerOnFirstPage })}
          />
        </Field>
        <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
          <legend className="p-0 text-sm font-medium">
            {t("documentDesigner.margins.legend")}
          </legend>
          <div className="grid grid-cols-4 gap-1">
            {MARGIN_SIDES.map((side) => (
              <Field
                key={side}
                id={`dd-layout-margin-${side}`}
                label={t(MARGIN_LABEL_KEYS[side])}
                hideLabel
              >
                <Input
                  kind="number"
                  id={`dd-layout-margin-${side}`}
                  name={`layout-margin-${side}`}
                  value={look.margins[side]}
                  onChange={(value) => patch({ margins: { ...look.margins, [side]: value ?? "" } })}
                  placeholder={String(defaultMargins[side])}
                  testId={`layout-margin-${side}`}
                />
              </Field>
            ))}
          </div>
        </fieldset>
      </RailField>
      <RailHint>{t("documentDesigner.margins.layoutHint")}</RailHint>
    </RailSection>
  );
}
