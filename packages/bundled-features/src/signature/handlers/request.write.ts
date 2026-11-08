import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  type AccessRule,
  defineWriteHandler,
  type HandlerContext,
  isUuid,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  NotFoundError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import {
  canCallerReadFileRef,
  type FileRef,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { PDFDocument } from "pdf-lib";
import { requestExecutor, signerExecutor } from "../entity.ts";
import { readTenantFile, sha256Hex } from "../files.ts";
import { RequestSignatureSchema } from "../payloads.ts";
import type { SubjectScope } from "../subject-scope.ts";
import {
  SIGNATURE_DEFAULT_VALIDITY_DAYS,
  SIGNATURE_REQUEST_ENTITY,
  SIGNATURE_REQUEST_STATUS,
  SIGNATURE_SIGNER_STATUS,
} from "../web/constants.ts";

export type RequestSignatureData = {
  readonly requestId: string;
  readonly signerIds: readonly string[];
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Encrypted or unparseable PDFs would fail later when the signature page is appended and leave the
// request stuck in all-signed.
async function isLoadablePdf(bytes: Uint8Array): Promise<boolean> {
  try {
    await PDFDocument.load(bytes);
    return true;
  } catch {
    return false;
  }
}

// A file the caller may not open through GET /files/:id answers like an unknown id, so ids cannot be probed.
async function isReadableTenantFile(ctx: HandlerContext, fileRefId: string): Promise<boolean> {
  if (!isUuid(fileRefId)) return false;
  const [fileRef] = await selectMany<FileRef>(ctx.db, fileRefsTable, {
    id: fileRefId,
    tenantId: ctx.user.tenantId,
    isDeleted: false,
  });
  return fileRef !== undefined && (await canCallerReadFileRef(ctx, fileRef));
}

export function createRequestHandler(access: AccessRule, scope: SubjectScope) {
  return defineWriteHandler<"request", typeof RequestSignatureSchema, RequestSignatureData>({
    name: "request",
    schema: RequestSignatureSchema,
    access,
    agent: { risk: "mid" },
    description:
      "Requests signatures on one PDF document of the tenant from one or more people; each signer signs on a display in person or through a link issued later. The document is referenced by file id and hash and never changed.",
    handler: async (event, ctx) => {
      const payload = event.payload;
      const user = event.user;
      if (!(await scope.allows(ctx, user, payload.subjectType, payload.subjectId))) {
        return writeFailure(new NotFoundError(SIGNATURE_REQUEST_ENTITY));
      }
      if (!(await isReadableTenantFile(ctx, payload.documentFileId))) {
        return writeFailure(new UnprocessableError("document_not_a_pdf"));
      }
      const document = await readTenantFile(ctx, user.tenantId, payload.documentFileId);
      if (document === null || !(await isLoadablePdf(document.content))) {
        return writeFailure(new UnprocessableError("document_not_a_pdf"));
      }
      const validityDays = payload.expiresInDays ?? SIGNATURE_DEFAULT_VALIDITY_DAYS;
      const now = ctx.tz.now();
      const created = await requestExecutor.create(
        {
          documentFileId: payload.documentFileId,
          documentSha256: sha256Hex(document.content),
          title: payload.title,
          level: payload.level,
          subjectType: payload.subjectType,
          subjectId: payload.subjectId,
          status: SIGNATURE_REQUEST_STATUS.Open,
          expiresAt: now.add({ milliseconds: validityDays * MS_PER_DAY }),
        },
        user,
        ctx.db,
      );
      if (!created.isSuccess) return created;
      const requestId = String(created.data.id);

      const signerIds: string[] = [];
      for (const signer of payload.signers) {
        const createdSigner = await signerExecutor.create(
          {
            requestId,
            name: signer.name,
            status: SIGNATURE_SIGNER_STATUS.Pending,
            viewCount: 0,
            ...(signer.role !== undefined && { role: signer.role }),
            ...(signer.contactId !== undefined && { contactId: signer.contactId }),
            ...(signer.email !== undefined && { email: signer.email.toLowerCase() }),
          },
          user,
          ctx.db,
        );
        if (!createdSigner.isSuccess) return createdSigner;
        signerIds.push(String(createdSigner.data.id));
      }
      return { isSuccess: true, data: { requestId, signerIds } };
    },
  });
}
