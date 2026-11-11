import {
  DOCUMENT_FONTS,
  type DocumentFont,
  type DocumentLayoutValues,
  HEX_COLOR_PATTERN,
  MAIL_LAYOUT_ACCENT_LINES,
  MAIL_LAYOUT_BUTTON_STYLES,
  MAIL_LAYOUT_FONTS,
  MAIL_LAYOUT_WIDTHS,
  PDF_DEFAULT_FONT_SIZE_PT,
  type PdfFoldMarks,
  type PdfTableStyle,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { MARGIN_SIDES, type MarginSide } from "./pdf-meta.ts";

export const LAYOUT_WIDTHS = MAIL_LAYOUT_WIDTHS;
export const LAYOUT_FONTS = MAIL_LAYOUT_FONTS;
export const LAYOUT_ACCENT_LINES = MAIL_LAYOUT_ACCENT_LINES;
export const LAYOUT_BUTTON_STYLES = MAIL_LAYOUT_BUTTON_STYLES;

export type LayoutWidth = (typeof LAYOUT_WIDTHS)[number];
export type LayoutFont = (typeof LAYOUT_FONTS)[number];
export type LayoutAccentLine = (typeof LAYOUT_ACCENT_LINES)[number];
export type LayoutButtonStyle = (typeof LAYOUT_BUTTON_STYLES)[number];

/** What the server stores; every field is optional and a missing one means the default. */
export type LayoutMeta = {
  readonly width?: LayoutWidth;
  readonly font?: LayoutFont;
  readonly outerBackground?: string;
  readonly accentLine?: LayoutAccentLine;
  readonly buttonStyle?: LayoutButtonStyle;
};

/** The five appearance values with defaults applied; `outerBackground` stays text while it is being typed. */
export type LayoutAppearance = {
  readonly width: LayoutWidth;
  readonly font: LayoutFont;
  readonly outerBackground: string;
  readonly accentLine: LayoutAccentLine;
  readonly buttonStyle: LayoutButtonStyle;
};

export const DEFAULT_LAYOUT_APPEARANCE: LayoutAppearance = {
  width: 600,
  font: "sans",
  outerBackground: "#f5f5f5",
  accentLine: "none",
  buttonStyle: "filled-rounded",
};

export function isHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

export function appearanceOf(meta: LayoutMeta): LayoutAppearance {
  return { ...DEFAULT_LAYOUT_APPEARANCE, ...meta };
}

/** Keeps a field that was already stored, even when it now equals the default; drops every other default. */
export function metaToSave(appearance: LayoutAppearance, stored: LayoutMeta): LayoutMeta {
  const defaults = DEFAULT_LAYOUT_APPEARANCE;
  const keep = (key: keyof LayoutAppearance): boolean =>
    appearance[key] !== defaults[key] || key in stored;
  return {
    ...(keep("width") && { width: appearance.width }),
    ...(keep("font") && { font: appearance.font }),
    ...(keep("outerBackground") && { outerBackground: appearance.outerBackground }),
    ...(keep("accentLine") && { accentLine: appearance.accentLine }),
    ...(keep("buttonStyle") && { buttonStyle: appearance.buttonStyle }),
  };
}

/** What a pdf-layout stores; every field is optional and a missing one means the renderer default. */
export type PdfLayoutMeta = {
  readonly margins?: Readonly<Partial<Record<MarginSide, number>>>;
  readonly fontFamily?: DocumentFont;
  readonly fontSizePt?: number;
  readonly textColor?: string;
  readonly tableStyle?: PdfTableStyle;
  readonly tableHeaderBackground?: string;
  readonly tableLineColor?: string;
  readonly foldMarks?: PdfFoldMarks;
  readonly cornerMarks?: boolean;
  readonly paperColor?: string;
  readonly headerOnFirstPage?: boolean;
  readonly footerOnFirstPage?: boolean;
};

/** The pdf-layout look as the form edits it: colors stay text while typed, empty means unset. */
export type PdfLayoutLook = {
  readonly margins: Readonly<Record<MarginSide, number | "">>;
  readonly fontFamily: DocumentFont;
  readonly fontSizePt: number | "";
  readonly textColor: string;
  readonly tableStyle: PdfTableStyle;
  readonly tableHeaderBackground: string;
  readonly tableLineColor: string;
  readonly foldMarks: PdfFoldMarks;
  readonly cornerMarks: boolean;
  readonly paperColor: string;
  readonly headerOnFirstPage: boolean;
  readonly footerOnFirstPage: boolean;
};

export const PDF_LAYOUT_FONT_SIZE_RANGE = { min: 6, max: 24 } as const;
export const PDF_LAYOUT_MARGIN_RANGE = { min: 0, max: 100 } as const;

// The renderer's own defaults, so an untouched layout stores nothing.
export const DEFAULT_PDF_FONT_SIZE_PT = PDF_DEFAULT_FONT_SIZE_PT;

export const DEFAULT_PDF_LAYOUT_LOOK: PdfLayoutLook = {
  margins: { top: "", right: "", bottom: "", left: "" },
  fontFamily: DOCUMENT_FONTS[0],
  fontSizePt: DEFAULT_PDF_FONT_SIZE_PT,
  textColor: "#222222",
  tableStyle: "plain",
  tableHeaderBackground: "",
  tableLineColor: "",
  foldMarks: "none",
  cornerMarks: false,
  paperColor: "",
  headerOnFirstPage: true,
  footerOnFirstPage: true,
};

function marginsLookOf(meta: PdfLayoutMeta): PdfLayoutLook["margins"] {
  return {
    top: meta.margins?.top ?? "",
    right: meta.margins?.right ?? "",
    bottom: meta.margins?.bottom ?? "",
    left: meta.margins?.left ?? "",
  };
}

function textLookOf(meta: PdfLayoutMeta) {
  const defaults = DEFAULT_PDF_LAYOUT_LOOK;
  return {
    fontFamily: meta.fontFamily ?? defaults.fontFamily,
    fontSizePt: meta.fontSizePt ?? defaults.fontSizePt,
    textColor: meta.textColor ?? defaults.textColor,
    paperColor: meta.paperColor ?? defaults.paperColor,
  };
}

function tableLookOf(meta: PdfLayoutMeta) {
  const defaults = DEFAULT_PDF_LAYOUT_LOOK;
  return {
    tableStyle: meta.tableStyle ?? defaults.tableStyle,
    tableHeaderBackground: meta.tableHeaderBackground ?? defaults.tableHeaderBackground,
    tableLineColor: meta.tableLineColor ?? defaults.tableLineColor,
  };
}

function pageLookOf(meta: PdfLayoutMeta) {
  const defaults = DEFAULT_PDF_LAYOUT_LOOK;
  return {
    foldMarks: meta.foldMarks ?? defaults.foldMarks,
    cornerMarks: meta.cornerMarks ?? defaults.cornerMarks,
    headerOnFirstPage: meta.headerOnFirstPage ?? defaults.headerOnFirstPage,
    footerOnFirstPage: meta.footerOnFirstPage ?? defaults.footerOnFirstPage,
  };
}

export function pdfLayoutLookOf(meta: PdfLayoutMeta): PdfLayoutLook {
  return {
    margins: marginsLookOf(meta),
    ...textLookOf(meta),
    ...tableLookOf(meta),
    ...pageLookOf(meta),
  };
}

function inRange(value: number, range: { readonly min: number; readonly max: number }): boolean {
  return value >= range.min && value <= range.max;
}

export function isPdfLayoutLookValid(look: PdfLayoutLook): boolean {
  return (
    isHexColor(look.textColor) &&
    (look.tableHeaderBackground === "" || isHexColor(look.tableHeaderBackground)) &&
    (look.tableLineColor === "" || isHexColor(look.tableLineColor)) &&
    (look.paperColor === "" || isHexColor(look.paperColor)) &&
    (look.fontSizePt === "" || inRange(look.fontSizePt, PDF_LAYOUT_FONT_SIZE_RANGE)) &&
    MARGIN_SIDES.every((side) => {
      const mm = look.margins[side];
      return mm === "" || inRange(mm, PDF_LAYOUT_MARGIN_RANGE);
    })
  );
}

export function samePdfLayoutLook(a: PdfLayoutLook, b: PdfLayoutLook): boolean {
  return (
    MARGIN_SIDES.every((side) => a.margins[side] === b.margins[side]) &&
    a.fontFamily === b.fontFamily &&
    a.fontSizePt === b.fontSizePt &&
    a.textColor === b.textColor &&
    a.tableStyle === b.tableStyle &&
    a.tableHeaderBackground === b.tableHeaderBackground &&
    a.tableLineColor === b.tableLineColor &&
    a.foldMarks === b.foldMarks &&
    a.cornerMarks === b.cornerMarks &&
    a.paperColor === b.paperColor &&
    a.headerOnFirstPage === b.headerOnFirstPage &&
    a.footerOnFirstPage === b.footerOnFirstPage
  );
}

type KeepStored = (key: keyof PdfLayoutMeta, differs: boolean) => boolean;

function marginsMetaToSave(look: PdfLayoutLook): PdfLayoutMeta {
  const margins: Partial<Record<MarginSide, number>> = {};
  for (const side of MARGIN_SIDES) {
    const mm = look.margins[side];
    if (mm !== "") margins[side] = mm;
  }
  return Object.keys(margins).length > 0 ? { margins } : {};
}

function textMetaToSave(look: PdfLayoutLook, keep: KeepStored): PdfLayoutMeta {
  const defaults = DEFAULT_PDF_LAYOUT_LOOK;
  return {
    ...(keep("fontFamily", look.fontFamily !== defaults.fontFamily) && {
      fontFamily: look.fontFamily,
    }),
    ...(look.fontSizePt !== "" &&
      keep("fontSizePt", look.fontSizePt !== defaults.fontSizePt) && {
        fontSizePt: look.fontSizePt,
      }),
    ...(keep("textColor", look.textColor !== defaults.textColor) && { textColor: look.textColor }),
    ...(look.paperColor !== "" && { paperColor: look.paperColor }),
  };
}

function tableMetaToSave(look: PdfLayoutLook, keep: KeepStored): PdfLayoutMeta {
  const defaults = DEFAULT_PDF_LAYOUT_LOOK;
  return {
    ...(keep("tableStyle", look.tableStyle !== defaults.tableStyle) && {
      tableStyle: look.tableStyle,
    }),
    ...(look.tableHeaderBackground !== "" && { tableHeaderBackground: look.tableHeaderBackground }),
    ...(look.tableLineColor !== "" && { tableLineColor: look.tableLineColor }),
  };
}

function pageMetaToSave(look: PdfLayoutLook, keep: KeepStored): PdfLayoutMeta {
  const defaults = DEFAULT_PDF_LAYOUT_LOOK;
  return {
    ...(keep("foldMarks", look.foldMarks !== defaults.foldMarks) && { foldMarks: look.foldMarks }),
    ...(keep("cornerMarks", look.cornerMarks !== defaults.cornerMarks) && {
      cornerMarks: look.cornerMarks,
    }),
    ...(keep("headerOnFirstPage", look.headerOnFirstPage !== defaults.headerOnFirstPage) && {
      headerOnFirstPage: look.headerOnFirstPage,
    }),
    ...(keep("footerOnFirstPage", look.footerOnFirstPage !== defaults.footerOnFirstPage) && {
      footerOnFirstPage: look.footerOnFirstPage,
    }),
  };
}

/** Keeps a field that was already stored, even when it now equals the default; drops every other default. */
export function pdfLayoutMetaToSave(look: PdfLayoutLook, stored: PdfLayoutMeta): PdfLayoutMeta {
  const keep: KeepStored = (key, differs) => differs || key in stored;
  return {
    ...marginsMetaToSave(look),
    ...textMetaToSave(look, keep),
    ...tableMetaToSave(look, keep),
    ...pageMetaToSave(look, keep),
  };
}

/** What the editor toolbar shows as the value a text select inherits. */
export function layoutValuesOf(look: PdfLayoutLook): DocumentLayoutValues {
  return {
    fontFamily: look.fontFamily,
    ...(look.fontSizePt !== "" && { fontSizePt: look.fontSizePt }),
  };
}
