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

export const PDF_TABLE_STYLES = ["plain", "lines", "header", "grid"] as const;
export type PdfTableStyle = (typeof PDF_TABLE_STYLES)[number];

// Corner marks: an angle in each paper corner, its vertex this far from both edges and its legs running toward the sheet's centre.
export const PDF_CORNER_MARK_INSET_MM = 10;
export const PDF_CORNER_MARK_LEG_MM = 5;
