// Turns the file references of an outgoing mail into bytes. Only the sender's own tenant is
// searched, so another tenant's file reads exactly like a missing one; a file the caller may not
// read counts as missing too (outbound-attachment-access.ts).

import {
  collectPiiSubjectFields,
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { fileRefEntity } from "@cosmicdrift/kumiko-framework/files";
import {
  FileRefTooLargeError,
  fileContextForTenant,
  readFileRefContent,
} from "../file-foundation/index.ts";
import { loadAttachableFileRef, mayAttachFileRef } from "./outbound-attachment-access.ts";
import { OUTBOUND_ATTACHMENTS_MAX_BYTES, type OutboundAttachment } from "./outbound-mail.ts";

export type ResolveOutboundAttachmentsContext = Pick<
  HandlerContext,
  "db" | "user" | "services" | "obs" | "registry" | "dispatch"
>;

export type ResolvedOutboundAttachments =
  | {
      readonly isSuccess: true;
      readonly attachments: readonly OutboundAttachment[];
      readonly fileIds: readonly string[];
    }
  | { readonly isSuccess: false; readonly failure: "attachmentInvalid" | "attachmentsTooLarge" };

const FALLBACK_ATTACHMENT_NAME = "attachment";
const PII_SUBJECT_FIELDS = collectPiiSubjectFields(fileRefEntity);

// The stored name is personal data and may be ciphertext; a name that cannot be read must not
// stop the mail, and ciphertext or the erased marker never goes into a header.
export async function readableFileName(file: {
  readonly id: string;
  readonly fileName: string;
}): Promise<string> {
  const storedName = file.fileName;
  if (!isPiiCiphertext(storedName)) return storedName;
  const kms = configuredPiiSubjectKms();
  if (!kms) return FALLBACK_ATTACHMENT_NAME;
  try {
    const decrypted = await decryptPiiFieldValues(
      { fileName: storedName },
      PII_SUBJECT_FIELDS,
      kms,
      { requestId: `outbound-attachment:${file.id}` },
    );
    const name = decrypted["fileName"];
    if (typeof name !== "string" || isPiiCiphertext(name) || name === PII_ERASED_SENTINEL) {
      return FALLBACK_ATTACHMENT_NAME;
    }
    return name;
  } catch {
    // skip: broken crypto metadata must not block the mail; the attachment keeps a neutral name.
    return FALLBACK_ATTACHMENT_NAME;
  }
}

export async function resolveOutboundAttachments(
  ctx: ResolveOutboundAttachmentsContext,
  fileIds: readonly string[],
): Promise<ResolvedOutboundAttachments> {
  const uniqueIds = [...new Set(fileIds)];
  const attachments: OutboundAttachment[] = [];
  let remainingBytes = OUTBOUND_ATTACHMENTS_MAX_BYTES;
  const tenantId = ctx.user.tenantId;
  for (const fileRefId of uniqueIds) {
    // A file the caller may not read answers like an unknown id, so ids cannot be probed.
    const fileRef = await loadAttachableFileRef(ctx, fileRefId);
    if (fileRef === null || !(await mayAttachFileRef(ctx, fileRef))) {
      return { isSuccess: false, failure: "attachmentInvalid" };
    }
    let found: Awaited<ReturnType<typeof readFileRefContent>>;
    try {
      found = await readFileRefContent({
        db: ctx.db,
        filesForTenant: (forTenantId) => fileContextForTenant(ctx, tenantId, forTenantId),
        fileRefId,
        allowedTenantIds: [tenantId],
        maxBytes: remainingBytes,
      });
    } catch (err) {
      if (err instanceof FileRefTooLargeError) {
        return { isSuccess: false, failure: "attachmentsTooLarge" };
      }
      ctx.obs.log.warn("outbound attachment could not be read", {
        fileRefId,
        errorName: err instanceof Error ? err.name : typeof err,
      });
      return { isSuccess: false, failure: "attachmentInvalid" };
    }
    if (found === null) return { isSuccess: false, failure: "attachmentInvalid" };
    if (found.content.byteLength > remainingBytes) {
      return { isSuccess: false, failure: "attachmentsTooLarge" };
    }
    remainingBytes -= found.content.byteLength;
    attachments.push({
      fileName: await readableFileName({ id: fileRefId, fileName: found.fileName }),
      mimeType: found.contentType,
      data: found.content,
    });
  }
  return { isSuccess: true, attachments, fileIds: uniqueIds };
}
