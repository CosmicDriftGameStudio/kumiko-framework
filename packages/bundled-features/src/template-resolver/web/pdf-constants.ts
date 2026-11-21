// No imports: web/ re-exports these, and constants.ts pulls in the framework engine.
export const PDF_PAGE_FORMATS = ["A4", "Letter"] as const;
export type PdfPageFormat = (typeof PDF_PAGE_FORMATS)[number];

// Long edge of the largest supported paper; the sanitizer has no template meta, so a frame is held to this on both axes.
export const PDF_MAX_PAGE_EDGE_MM = 297;

export const PDF_ORIENTATIONS = ["portrait", "landscape"] as const;
export type PdfOrientation = (typeof PDF_ORIENTATIONS)[number];

// Page margins in mm; the header/footer values apply when the layout contributes that region and the template sets no margin itself.
export const PDF_DEFAULT_MARGIN_MM = 15;
export const PDF_HEADER_MARGIN_MM = 30;
export const PDF_FOOTER_MARGIN_MM = 20;

// Body text size of a printed document; header and footer fall back to it, so no region reads smaller than the body.
export const PDF_DEFAULT_FONT_SIZE_PT = 10.5;

export const PDF_FOLD_MARKS = ["none", "din-a", "din-b"] as const;
export type PdfFoldMarks = (typeof PDF_FOLD_MARKS)[number];

// DIN 5008 distances from the top edge of an upright A4 sheet: form A folds at 87 and 192 mm, form B at 105 and 210 mm.
export const PDF_FOLD_MARK_POSITIONS_MM: Readonly<
  Record<
    Exclude<PdfFoldMarks, "none">,
    { readonly foldsMm: readonly number[]; readonly punchMm: number }
  >
> = {
  "din-a": { foldsMm: [87, 192], punchMm: 148.5 },
  "din-b": { foldsMm: [105, 210], punchMm: 148.5 },
};
export const PDF_FOLD_MARK_LENGTH_MM = 5;
export const PDF_PUNCH_MARK_LENGTH_MM = 8;

// The positions only make sense on upright A4; Letter or landscape sheets get no marks.
export function isFoldMarkPaper(widthMm: number, heightMm: number): boolean {
  return widthMm < heightMm && Math.abs(heightMm - PDF_MAX_PAGE_EDGE_MM) < 1;
}

export const PDF_TABLE_STYLES = ["plain", "lines", "header", "grid"] as const;
export type PdfTableStyle = (typeof PDF_TABLE_STYLES)[number];

// Corner marks: an angle in each paper corner, its vertex this far from both edges and its legs running toward the sheet's centre.
export const PDF_CORNER_MARK_INSET_MM = 10;
export const PDF_CORNER_MARK_LEG_MM = 5;
