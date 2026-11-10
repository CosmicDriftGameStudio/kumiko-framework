export const DOCUMENT_FONTS = ["arial", "times", "courier", "calibri", "cambria"] as const;
export type DocumentFont = (typeof DOCUMENT_FONTS)[number];

export const DOCUMENT_FONT_LABELS: Readonly<Record<DocumentFont, string>> = {
  arial: "Arial",
  times: "Times New Roman",
  courier: "Courier New",
  calibri: "Calibri",
  cambria: "Cambria",
};

// The first family is the metric-compatible font installed in the print service, so the PDF
// wraps lines like the Office font the author picked.
// Single quotes only: the stacks land in double-quoted style attributes, where a double quote ends the attribute.
export const DOCUMENT_FONT_PRINT_STACKS: Readonly<Record<DocumentFont, string>> = {
  arial: "'Liberation Sans',Arial,sans-serif",
  times: "'Liberation Serif','Times New Roman',serif",
  courier: "'Liberation Mono','Courier New',monospace",
  calibri: "Carlito,Calibri,sans-serif",
  cambria: "Caladea,Cambria,serif",
};
