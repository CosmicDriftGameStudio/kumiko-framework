// PDF Audit Export Sample
//
// A write handler turns tenant data into a PDF and keeps it as a regular
// FileRef: renderTablePdf draws the table (pure JS, no browser). The storage
// write runs in the beforeTransaction phase, so the transaction holds no pool
// connection while the bytes upload; the handler then only creates the
// fileRef row from event.prepared.

import { renderTablePdf } from "@cosmicdrift/kumiko-bundled-features/renderer-pdf";
import {
  createDateField,
  createEntity,
  createEntityExecutor,
  createSelectField,
  createTextField,
  defineFeature,
  defineWriteHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createFileRefFromUploadedBytes,
  uploadFileBytesBeforeTransaction,
} from "@cosmicdrift/kumiko-framework/files";
import * as z from "zod";

export const INSPECTION_RESULTS = ["ok", "defect"] as const;

export const inspectionEntity = createEntity({
  table: "read_sample_inspections",
  fields: {
    assetName: createTextField({ personal: false, reason: "is_business_data", required: true }),
    inspectedOn: createDateField({ required: true }),
    result: createSelectField({ options: INSPECTION_RESULTS, required: true }),
    inspector: createTextField({ personal: "ref" }),
  },
});

const RESULT_LABELS: Readonly<Record<(typeof INSPECTION_RESULTS)[number], string>> = {
  ok: "In Ordnung",
  defect: "Mangel",
};

// The renderer takes ready-formatted strings, so date formatting stays with the caller.
function formatGermanDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}.${month}.${year}`;
}

function toFileNameSegment(text: string): string {
  return text.replaceAll(/[^A-Za-z0-9_-]+/g, "-");
}

const AUDIT_ROW_LIMIT = 200;

const access = { access: { roles: ["Admin", "User"] } } as const;

export const pdfAuditExportFeature = defineFeature("pdf-audit-export", (r) => {
  r.entity("inspection", inspectionEntity);
  const { executor: inspectionExecutor } = createEntityExecutor("inspection", inspectionEntity);

  r.writeHandler(
    "inspection:create",
    z.object({
      assetName: z.string().min(1),
      inspectedOn: z.iso.date(),
      result: z.enum(INSPECTION_RESULTS),
      inspector: z.string().optional(),
    }),
    async (event, ctx) => inspectionExecutor.create(event.payload, event.user, ctx.db),
    access,
  );

  r.writeHandler(
    defineWriteHandler({
      name: "export-audit",
      schema: z.object({ assetName: z.string().min(1), from: z.iso.date(), to: z.iso.date() }),
      access: access.access,
      beforeTransaction: async (event, ctx) => {
        const { assetName, from, to } = event.payload;
        const inspections = await inspectionExecutor.list(
          {
            filters: [
              { field: "assetName", op: "eq", value: assetName },
              { field: "inspectedOn", op: "gte", value: from },
              { field: "inspectedOn", op: "lte", value: to },
            ],
            sort: "inspectedOn",
            sortDirection: "asc",
            limit: AUDIT_ROW_LIMIT,
          },
          event.user,
          ctx.db,
        );

        const { pdfBytes } = await renderTablePdf({
          title: `Prüfprotokoll ${assetName}`,
          meta: [
            { label: "Zeitraum", value: `${formatGermanDate(from)} bis ${formatGermanDate(to)}` },
            { label: "Prüfungen", value: String(inspections.rows.length) },
          ],
          columns: [{ header: "Datum" }, { header: "Ergebnis" }, { header: "Prüfer", weight: 2 }],
          rows: inspections.rows.map((row) => [
            formatGermanDate(String(row["inspectedOn"])),
            RESULT_LABELS[z.enum(INSPECTION_RESULTS).parse(row["result"])],
            String(row["inspector"] ?? ""),
          ]),
          emptyText: "Keine Prüfungen im Zeitraum",
          footerText: `Prüfbericht ${assetName}`,
          pageLabel: "Seite {page} von {pages}",
        });

        return uploadFileBytesBeforeTransaction(ctx, {
          fileName: `audit-${toFileNameSegment(assetName)}.pdf`,
          mimeType: "application/pdf",
          data: pdfBytes,
        });
      },
      handler: async (event, ctx) => {
        const created = await createFileRefFromUploadedBytes(ctx, event.prepared);
        if (!created.isSuccess) return created;
        return { isSuccess: true as const, data: { fileRefId: created.data.id } };
      },
    }),
  );
});
