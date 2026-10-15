import * as z from "zod";
import type { InlineAttachmentRef } from "../renderer-foundation/index.js";
import { isDocumentResourceKey } from "../template-resolver/index.js";

export type { InlineAttachmentRef };
export type FileAttachmentRef = {
  readonly kind: "file";
  readonly fileRefId: string;
  readonly fileName: string;
};
// Open union: kumiko-framework#3700 adds { kind: "rendered-pdf"; templateSlug; variables; fileName }.
export type EmailAttachmentRef = InlineAttachmentRef | FileAttachmentRef;

export const MAX_EMAIL_ATTACHMENTS = 20;

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

export const emailAttachmentRefSchema = z.discriminatedUnion("kind", [
  inlineAttachmentRefSchema,
  fileAttachmentRefSchema,
]);

// Rebuilds only the contract fields so bytes a caller attached to a ref object
// can never ride into a job payload.
export function toAttachmentRef(ref: EmailAttachmentRef): EmailAttachmentRef {
  switch (ref.kind) {
    case "inline":
      return { kind: "inline", cid: ref.cid, fileRefId: ref.fileRefId };
    case "file":
      return { kind: "file", fileRefId: ref.fileRefId, fileName: ref.fileName };
  }
}
