import * as z from "zod";
import { HEX_COLOR_PATTERN, PDF_PAGE_FORMATS, type TemplateKind } from "./constants.js";

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

// Rows saved before the sender key was dropped still carry it; discard it on read so they stay editable.
function withoutLegacySender(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || !("sender" in raw)) return raw;
  const { sender: _legacySender, ...rest } = raw;
  return rest;
}

const mailMetaSchema = z.preprocess(
  withoutLegacySender,
  z
    .object({
      subject: singleLine(200).min(1),
      previewText: singleLine(200).optional(),
      layoutSlug: templateSlugSchema.optional(),
      category: z.enum(MAIL_CATEGORIES).optional(),
      senderName: singleLine(80).min(1).optional(),
      replyTo: singleLine(254).pipe(z.email()).optional(),
    })
    .strict(),
);

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

const MAIL_LAYOUT_FONTS = ["sans", "serif"] as const;
const MAIL_LAYOUT_ACCENT_LINES = ["branding", "none"] as const;
const MAIL_LAYOUT_BUTTON_STYLES = ["filled-rounded", "filled-square", "outline"] as const;

const mailLayoutMetaSchema = z
  .object({
    width: z.union([z.literal(560), z.literal(600), z.literal(640)]).optional(),
    font: z.enum(MAIL_LAYOUT_FONTS).optional(),
    outerBackground: z.string().regex(HEX_COLOR_PATTERN, "must be a #rrggbb color").optional(),
    accentLine: z.enum(MAIL_LAYOUT_ACCENT_LINES).optional(),
    buttonStyle: z.enum(MAIL_LAYOUT_BUTTON_STYLES).optional(),
  })
  .strict();

const pdfLayoutMetaSchema = z.object({}).strict();

export type MailTemplateMeta = z.infer<typeof mailMetaSchema>;
export type PdfTemplateMeta = z.infer<typeof pdfMetaSchema>;
export type MailLayoutMeta = z.infer<typeof mailLayoutMetaSchema>;
export type LayoutTemplateMeta = MailLayoutMeta | z.infer<typeof pdfLayoutMetaSchema>;
export type TemplateMeta = MailTemplateMeta | PdfTemplateMeta | LayoutTemplateMeta;

export function isMailTemplateMeta(meta: TemplateMeta | null): meta is MailTemplateMeta {
  return meta !== null && "subject" in meta;
}

export function readPdfTemplateMeta(meta: TemplateMeta | null): PdfTemplateMeta | null {
  const parsed = pdfMetaSchema.safeParse(meta);
  return parsed.success ? parsed.data : null;
}

export function readMailLayoutMeta(meta: unknown): MailLayoutMeta {
  const parsed = mailLayoutMetaSchema.safeParse(meta ?? {});
  return parsed.success ? parsed.data : {};
}

export type TemplateMetaIssue = {
  readonly path: string;
  /** The setting the issue is about (`subject`), `meta` when it concerns the object as a whole. */
  readonly field: string;
  /** The value is absent or empty, as opposed to present and wrong. */
  readonly missing: boolean;
  /** Parser wording; for logs and tests, never for the UI. */
  readonly message: string;
};

function valueAt(raw: unknown, path: readonly PropertyKey[]): unknown {
  let current: unknown = raw;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = Object.entries(current).find(([name]) => name === String(key))?.[1];
  }
  return current;
}

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
      return mailLayoutMetaSchema;
    case "pdf-layout":
      return pdfLayoutMetaSchema;
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
      : {
          ok: false,
          issues: [
            {
              path: "meta",
              field: "meta",
              missing: false,
              message: `kind ${kind} does not take meta`,
            },
          ],
        };
  }
  if ((raw === undefined || raw === null) && kind !== "mail") return { ok: true, meta: null };
  const parsed = schema.safeParse(raw ?? undefined);
  if (parsed.success) return { ok: true, meta: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => {
      const value = valueAt(raw, issue.path);
      return {
        path: ["meta", ...issue.path.map(String)].join("."),
        field: issue.path.length === 0 ? "meta" : String(issue.path[0]),
        missing: value === undefined || value === "",
        message: issue.message,
      };
    }),
  };
}
