import * as z from "zod";
import { PDF_PAGE_FORMATS, type TemplateKind } from "./constants.js";

// One or more kebab segments joined by ":" — notification templates are seeded
// under their qualified name `feature:notify:name`.
export const templateSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*(:[a-z0-9]+(-[a-z0-9]+)*)*$/,
    "slug must be kebab-case segments joined by ':'",
  );

export const MAIL_CATEGORIES = ["transactional", "marketing"] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

// Header values: a CR/LF would let an author inject extra mail headers.
const singleLine = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !/[\r\n]/.test(value), "must not contain line breaks");

const mailMetaSchema = z
  .object({
    subject: singleLine(200).min(1),
    previewText: singleLine(200).optional(),
    layoutSlug: templateSlugSchema.optional(),
    category: z.enum(MAIL_CATEGORIES).optional(),
    sender: z
      .string()
      .max(60)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "sender must be a kebab-case key")
      .optional(),
  })
  .strict();

const PDF_ORIENTATIONS = ["portrait", "landscape"] as const;

const marginMm = z.number().finite().min(0).max(100).optional();

// The file name ends up in a Content-Disposition header and on disk.
const FORBIDDEN_FILE_NAME = /[/\\";]|\.\./;

// Name of a PDF rendered into a mail; {{placeholders}} are filled at render time.
export const pdfAttachmentFileNamePatternSchema = singleLine(200)
  .min(1)
  .refine((value) => !FORBIDDEN_FILE_NAME.test(value), 'must not contain / \\ " ; or ..')
  .refine((value) => value.toLowerCase().endsWith(".pdf"), "must end with .pdf");

const pdfMetaSchema = z
  .object({
    layoutSlug: templateSlugSchema.optional(),
    pageFormat: z.enum(PDF_PAGE_FORMATS).optional(),
    orientation: z.enum(PDF_ORIENTATIONS).optional(),
    printBackground: z.boolean().optional(),
    layoutHeaderFooter: z.boolean().optional(),
    margins: z
      .object({ top: marginMm, right: marginMm, bottom: marginMm, left: marginMm })
      .strict()
      .optional(),
    fileName: singleLine(200)
      .min(1)
      .refine((value) => !FORBIDDEN_FILE_NAME.test(value), 'must not contain / \\ " ; or ..')
      .optional(),
    metadata: z
      .object({ title: singleLine(200).optional(), author: singleLine(200).optional() })
      .strict()
      .optional(),
  })
  .strict();

const layoutMetaSchema = z.object({}).strict();

export type MailTemplateMeta = z.infer<typeof mailMetaSchema>;
export type PdfTemplateMeta = z.infer<typeof pdfMetaSchema>;
export type LayoutTemplateMeta = z.infer<typeof layoutMetaSchema>;
export type TemplateMeta = MailTemplateMeta | PdfTemplateMeta | LayoutTemplateMeta;

export function isMailTemplateMeta(meta: TemplateMeta | null): meta is MailTemplateMeta {
  return meta !== null && "subject" in meta;
}

export function readPdfTemplateMeta(meta: TemplateMeta | null): PdfTemplateMeta | null {
  const parsed = pdfMetaSchema.safeParse(meta);
  return parsed.success ? parsed.data : null;
}

export type TemplateMetaIssue = { readonly path: string; readonly message: string };

export type TemplateMetaResult =
  | { readonly ok: true; readonly meta: TemplateMeta | null }
  | { readonly ok: false; readonly issues: readonly TemplateMetaIssue[] };

function schemaForKind(kind: TemplateKind) {
  switch (kind) {
    case "mail":
      return mailMetaSchema;
    case "document-pdf":
      return pdfMetaSchema;
    case "mail-layout":
    case "pdf-layout":
      return layoutMetaSchema;
    default:
      return null;
  }
}

// Kinds without a meta schema must not carry meta at all; mail needs it,
// layouts and PDFs may omit it.
export function parseTemplateMeta(kind: TemplateKind, raw: unknown): TemplateMetaResult {
  const schema = schemaForKind(kind);
  if (schema === null) {
    return raw === undefined || raw === null
      ? { ok: true, meta: null }
      : { ok: false, issues: [{ path: "meta", message: `kind ${kind} does not take meta` }] };
  }
  if ((raw === undefined || raw === null) && kind !== "mail") return { ok: true, meta: null };
  const parsed = schema.safeParse(raw ?? undefined);
  if (parsed.success) return { ok: true, meta: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: ["meta", ...issue.path.map(String)].join("."),
      message: issue.message,
    })),
  };
}
