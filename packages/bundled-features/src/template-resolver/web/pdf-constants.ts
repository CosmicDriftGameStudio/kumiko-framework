// No imports: web/ re-exports these, and constants.ts pulls in the framework engine.
export const PDF_PAGE_FORMATS = ["A4", "Letter"] as const;
export type PdfPageFormat = (typeof PDF_PAGE_FORMATS)[number];

export const PDF_ORIENTATIONS = ["portrait", "landscape"] as const;
export type PdfOrientation = (typeof PDF_ORIENTATIONS)[number];

// Page margins in mm; the header/footer values apply when the layout contributes that region and the template sets no margin itself.
export const PDF_DEFAULT_MARGIN_MM = 15;
export const PDF_HEADER_MARGIN_MM = 30;
export const PDF_FOOTER_MARGIN_MM = 20;
