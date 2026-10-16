import * as z from "zod";
import type { InlineAttachmentRef } from "../renderer-foundation/index.js";
import { isDocumentResourceKey, templateSlugSchema } from "../template-resolver/index.js";

export type { InlineAttachmentRef };
export type FileAttachmentRef = {
  readonly kind: "file";
  readonly fileRefId: string;
  readonly fileName: string;
};
// A PDF rendered from a stored document template when the mail is sent, so the job
// payload carries the variables instead of the bytes.
export type RenderedPdfAttachmentRef = {
  readonly kind: "rendered-pdf";
  readonly templateSlug: string;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly fileName: string;
  readonly locale?: string;
};
export type EmailAttachmentRef = InlineAttachmentRef | FileAttachmentRef | RenderedPdfAttachmentRef;

export const MAX_EMAIL_ATTACHMENTS = 20;

export const MAX_RENDERED_PDF_VARIABLES_BYTES = 64_000;

const MAX_ID_LENGTH = 64;
const MAX_FILE_NAME_LENGTH = 255;

function hasControlCharacter(value: string): boolean {
  return value.split("").some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

const fileRefIdSchema = z.string().min(1).max(MAX_ID_LENGTH);

const attachmentFileNameSchema = z
  .string()
  .min(1)
  .max(MAX_FILE_NAME_LENGTH)
  .refine((name) => !name.includes("/") && !name.includes("\\") && !hasControlCharacter(name), {
    message: "file name must not contain path separators or control characters",
  });

export const inlineAttachmentRefSchema = z
  .object({
    kind: z.literal("inline"),
    cid: z.string().min(1).max(MAX_ID_LENGTH).refine(isDocumentResourceKey),
    fileRefId: fileRefIdSchema,
  })
  .strict();

export const fileAttachmentRefSchema = z
  .object({
    kind: z.literal("file"),
    fileRefId: fileRefIdSchema,
    fileName: attachmentFileNameSchema,
  })
  .strict();

export const renderedPdfAttachmentRefSchema = z
  .object({
    kind: z.literal("rendered-pdf"),
    templateSlug: templateSlugSchema,
    variables: z
      .record(z.string(), z.unknown())
      .refine(
        (value) => Buffer.byteLength(JSON.stringify(value)) <= MAX_RENDERED_PDF_VARIABLES_BYTES,
        {
          message: `variables must not exceed ${MAX_RENDERED_PDF_VARIABLES_BYTES} bytes as JSON`,
        },
      ),
    fileName: attachmentFileNameSchema.refine((name) => name.toLowerCase().endsWith(".pdf"), {
      message: "file name must end with .pdf",
    }),
    locale: z
      .string()
      .min(2)
      .max(8)
      .regex(/^[a-z]{2}(-[a-z]{2})?$/i, "locale must be ISO 639-1 (e.g. de, en, en-us)")
      .optional(),
  })
  .strict();

export const emailAttachmentRefSchema = z.discriminatedUnion("kind", [
  inlineAttachmentRefSchema,
  fileAttachmentRefSchema,
  renderedPdfAttachmentRefSchema,
]);

// Rebuilds only the contract fields so bytes a caller attached to a ref object
// can never ride into a job payload.
export function toAttachmentRef(ref: EmailAttachmentRef): EmailAttachmentRef {
  switch (ref.kind) {
    case "inline":
      return { kind: "inline", cid: ref.cid, fileRefId: ref.fileRefId };
    case "file":
      return { kind: "file", fileRefId: ref.fileRefId, fileName: ref.fileName };
    case "rendered-pdf":
      return {
        kind: "rendered-pdf",
        templateSlug: ref.templateSlug,
        variables: ref.variables,
        fileName: ref.fileName,
        ...(ref.locale !== undefined && { locale: ref.locale }),
      };
  }
}
