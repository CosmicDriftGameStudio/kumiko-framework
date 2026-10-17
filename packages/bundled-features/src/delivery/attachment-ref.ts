import * as z from "zod";
import type {
  FileAttachmentRef,
  InlineAttachmentRef,
  RenderedPdfAttachmentRef,
} from "../renderer-foundation/index.js";
import { attachmentFileNameSchema } from "../shared/index.js";
import { isDocumentResourceKey, templateSlugSchema } from "../template-resolver/index.js";

export type { FileAttachmentRef, InlineAttachmentRef, RenderedPdfAttachmentRef };
export type EmailAttachmentRef = InlineAttachmentRef | FileAttachmentRef | RenderedPdfAttachmentRef;

export const MAX_EMAIL_ATTACHMENTS = 20;

export const MAX_RENDERED_PDF_VARIABLES_BYTES = 64_000;

// Channel-data keys that steer delivery itself (envelope, headers, attachments);
// they are not document variables and must not be copied into attached PDF refs.
export const DELIVERY_ENVELOPE_DATA_KEYS = [
  "attachments",
  "from",
  "fromName",
  "replyTo",
  "headers",
  "unsubscribeUrl",
] as const;

const DELIVERY_ENVELOPE_DATA_KEY_SET: ReadonlySet<string> = new Set(DELIVERY_ENVELOPE_DATA_KEYS);

export function withoutDeliveryEnvelopeKeys(
  variables: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(variables).filter(([key]) => !DELIVERY_ENVELOPE_DATA_KEY_SET.has(key)),
  );
}

const MAX_ID_LENGTH = 64;

const fileRefIdSchema = z.string().min(1).max(MAX_ID_LENGTH);

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
