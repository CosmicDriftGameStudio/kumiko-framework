import type { Translate } from "@cosmicdrift/kumiko-renderer/headless";
import { DOCUMENT_FONT_LABELS } from "./document-fonts.ts";
import { documentLinePt, PARAGRAPH_DEFAULT_LINE_HEIGHT } from "./document-style-css.ts";
import type { DocumentLayoutValues } from "./document-toolbar-blocks.ts";
import { PDF_DEFAULT_FONT_SIZE_PT } from "./pdf-constants.ts";

export type PrintDefaultLabels = {
  readonly font: string;
  readonly size: string;
  readonly lineHeight: string;
  readonly spaceBefore: string;
  readonly spaceAfter: string;
  readonly formatSize: (value: number) => string;
  readonly formatLineHeight: (value: number) => string;
  readonly formatSpaceBefore: (value: number) => string;
  readonly formatSpaceAfter: (value: number) => string;
};

// The first option of every print select stands for "inherit"; it shows the value the layout
// gives, or the control's own name when the layout is not known (mail, no layout).
export function printDefaultLabelsOf(
  t: Translate,
  locale: string,
  values: DocumentLayoutValues,
): PrintDefaultLabels {
  const formatNumber = (value: number): string => new Intl.NumberFormat(locale).format(value);
  const formatSize = (value: number): string =>
    t("documentDesigner.editor.defaultSize", { value: formatNumber(value) });
  const formatLineHeight = (value: number): string =>
    t("documentDesigner.editor.defaultLineHeight", { value: formatNumber(value) });
  const formatSpaceBefore = (value: number): string =>
    t("documentDesigner.editor.defaultSpaceBefore", { value: formatNumber(value) });
  const formatSpaceAfter = (value: number): string =>
    t("documentDesigner.editor.defaultSpaceAfter", { value: formatNumber(value) });
  const known = <T>(value: T | undefined, label: (known: T) => string, fallbackKey: string) =>
    value === undefined ? t(fallbackKey) : label(value);
  return {
    font: known(
      values.fontFamily,
      (font) => DOCUMENT_FONT_LABELS[font],
      "documentDesigner.editor.font",
    ),
    size: known(values.fontSizePt, formatSize, "documentDesigner.editor.fontSize"),
    // Without a layout value the paragraph still has the shared print default, so show that.
    lineHeight: formatLineHeight(values.lineHeight ?? PARAGRAPH_DEFAULT_LINE_HEIGHT),
    spaceBefore: known(
      values.spaceBeforePt,
      formatSpaceBefore,
      "documentDesigner.editor.spaceBeforeShort",
    ),
    spaceAfter: formatSpaceAfter(
      values.spaceAfterPt ?? documentLinePt(values.fontSizePt ?? PDF_DEFAULT_FONT_SIZE_PT),
    ),
    formatSize,
    formatLineHeight,
    formatSpaceBefore,
    formatSpaceAfter,
  };
}
