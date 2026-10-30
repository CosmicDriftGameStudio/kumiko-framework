# renderer-pdf

Public `document-pdf` renderer plugin: draws a table document as PDF in pure JavaScript (`pdf-lib`, standard Helvetica fonts), no browser and no Puppeteer service. Same input gives byte-identical output.

## Pure function

```typescript
import { renderTablePdf } from "@cosmicdrift/kumiko-bundled-features/renderer-pdf";

const { pdfBytes, pageCount } = await renderTablePdf(
  {
    title: "Prüfprotokoll",
    meta: [{ label: "Anlage", value: "Kessel 3" }],
    columns: [
      { header: "Datum" },
      { header: "Prüfer", weight: 2 },
      { header: "Kosten", align: "right" },
    ],
    rows: [["03.02.2026", "Müller", "120,00 €"]],
    footerText: "Kumiko GmbH",
    pageLabel: "Seite {page} von {pages}",
  },
  { format: "A4" },
);
```

The caller passes ready-formatted strings (dates, numbers); the renderer never reads the clock. Characters Helvetica (WinAnsi) cannot encode are drawn as `?`; umlauts, `ß` and `€` are kept.

## Plugin

Mount `createRendererPdfFeature()` next to `renderer-foundation`. It serves `kind: "document-pdf"` with a `PdfTableDocument` in `payload.variables`; `options.format` and `options.marginMm` apply. Invalid variables raise `RendererError("invalid_payload")`. A Puppeteer plugin keeps precedence (`DEFAULT_PLUGIN_BY_KIND`) when mounted.
