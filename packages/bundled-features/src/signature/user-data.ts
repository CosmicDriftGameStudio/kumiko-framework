import { configuredPiiSubjectKms } from "@cosmicdrift/kumiko-framework/crypto";
import { WritePurposes } from "@cosmicdrift/kumiko-framework/db";
import { deleteStoredFileAndDerivatives } from "@cosmicdrift/kumiko-framework/derivatives";
import {
  createSystemUser,
  type SessionUser,
  type UserDataDeleteHook,
  type UserDataExportHook,
  type UserDataHookCtx,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { collectErasureFailure, throwIfErasureFailed } from "../shared/index.ts";
import { resolveVerifiedUserEmail } from "../user/index.ts";
import { requestExecutor, signatureSignerTable, signerExecutor } from "./entity.ts";
import { deleteFileRef } from "./files.ts";
import { setRequestStatus } from "./lib.ts";
import { SIGNATURE_REQUEST_STATUS, SIGNATURE_SIGNER_ENTITY } from "./web/constants.ts";

const PII_DECRYPT_REASON = "signature:user-data";
const ANONYMIZED_NAME = "anonymized";
const ERASE_REASON = "signature:subject-forget";

type SignerRecord = Record<string, unknown>;

// A signer has no user account: the only link to a user is the signer's email, which is stored
// lowercase and findable by exact match. Without a verified email nothing matches.
async function findSignerRows(ctx: UserDataHookCtx): Promise<readonly SignerRecord[]> {
  const email = await resolveVerifiedUserEmail(ctx, PII_DECRYPT_REASON);
  if (email === null) return [];
  return ctx.db.selectMany<SignerRecord>(signatureSignerTable, {
    tenantId: ctx.tenantId,
    email: email.toLowerCase(),
  });
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// The signer's fields belong to the row's own record key, not to the user's key, so the user
// forget run does not shred them; and anonymizing only empties the current row, the old events
// still hold the ciphertext. Without a mounted KMS this erases nothing: record-owned fields stay
// plaintext framework-wide (see notes-history-user-data), so apps that need Art. 17 coverage mount one.
async function shredSignerKey(ctx: UserDataHookCtx, signerId: string): Promise<void> {
  // skip: no KMS adapter mounted, nothing is encrypted per record
  await configuredPiiSubjectKms()?.eraseKey(
    { kind: "record", entity: SIGNATURE_SIGNER_ENTITY, id: signerId },
    { requestId: ERASE_REASON, userId: ctx.userId, eraseReason: ERASE_REASON },
  );
}

export const signatureExportHook: UserDataExportHook = async (ctx) => {
  const rows = await findSignerRows(ctx);
  if (rows.length === 0) return null;
  return {
    entity: SIGNATURE_SIGNER_ENTITY,
    rows: rows.map((row) => ({
      requestId: row["requestId"],
      name: row["name"],
      role: row["role"],
      status: row["status"],
      method: row["method"],
      signedAt: String(row["signedAt"] ?? ""),
      signedFromIp: row["signedFromIp"],
      signedUserAgent: row["signedUserAgent"],
      declineReason: row["declineReason"],
    })),
  };
};

async function purgeSignatureImage(
  ctx: UserDataHookCtx,
  systemUser: SessionUser,
  imageFileId: string,
): Promise<void> {
  const [ref] = await ctx.db.selectMany<{ id: string; storageKey: string }>(fileRefsTable, {
    id: imageFileId,
  });
  // skip: the image is already gone, nothing left to erase
  if (ref === undefined) return;
  const provider = await ctx.buildStorageProvider?.(ctx.tenantId);
  if (!provider) {
    throw new InternalError({
      message: `[signature:user-data] no file storage resolvable, signature image ${imageFileId} cannot be erased`,
    });
  }
  const failed = await deleteStoredFileAndDerivatives(ref.storageKey, provider, PII_DECRYPT_REASON);
  if (failed.length > 0) {
    throw new InternalError({
      message: `[signature:user-data] ${failed.length} byte delete(s) failed for signature image ${imageFileId}`,
    });
  }
  await deleteFileRef(ctx.db, systemUser, imageFileId);
}

async function cancelUnfinishedRequest(
  ctx: UserDataHookCtx,
  systemUser: SessionUser,
  requestId: string,
): Promise<void> {
  const request = await requestExecutor.detail({ id: requestId }, systemUser, ctx.db);
  const status = request?.status;
  if (status !== SIGNATURE_REQUEST_STATUS.Open && status !== SIGNATURE_REQUEST_STATUS.AllSigned) {
    return;
  }
  await setRequestStatus(ctx, systemUser, requestId, status, {
    status: SIGNATURE_REQUEST_STATUS.Cancelled,
  });
}

// Erasure wins over retention for the person's own data: name, email, drawn image, IP address,
// user agent and refusal reason are removed (strategy delete: the whole row). What stays is the
// completed PDF with its signature page, which belongs to the request's owner as proof of the
// contract (Art. 17(3)(e) GDPR), and the row's status and timestamps under "anonymize". A forgotten
// signer would let the others complete the request without them (delete) or leave an all-signed
// request without the image it needs (anonymize), so an open or all-signed request is cancelled.
export const signatureDeleteHook: UserDataDeleteHook = async (ctx, strategy) => {
  const systemUser = createSystemUser(ctx.tenantId);
  const failures: string[] = [];
  for (const row of await findSignerRows(ctx)) {
    const id = stringOrNull(row["id"]);
    if (id === null) continue;
    const imageFileId = stringOrNull(row["imageFileId"]);
    if (imageFileId !== null) await purgeSignatureImage(ctx, systemUser, imageFileId);
    const requestId = stringOrNull(row["requestId"]);
    if (strategy === "delete") {
      const forgotten = await signerExecutor.forget({ id }, systemUser, ctx.db);
      collectErasureFailure(forgotten, SIGNATURE_SIGNER_ENTITY, id, failures);
      if (forgotten.isSuccess && requestId !== null) {
        await cancelUnfinishedRequest(ctx, systemUser, requestId);
      }
      if (forgotten.isSuccess) await shredSignerKey(ctx, id);
      continue;
    }
    const anonymized = await signerExecutor.update(
      {
        id,
        changes: {
          name: ANONYMIZED_NAME,
          email: null,
          imageFileId: null,
          signedFromIp: null,
          signedUserAgent: null,
          declineReason: null,
          linkAnchor: null,
        },
      },
      systemUser,
      ctx.db,
      { skipOptimisticLock: true, writePurpose: WritePurposes.erasure },
    );
    collectErasureFailure(anonymized, SIGNATURE_SIGNER_ENTITY, id, failures);
    if (!anonymized.isSuccess) continue;
    if (requestId !== null) await cancelUnfinishedRequest(ctx, systemUser, requestId);
    await shredSignerKey(ctx, id);
  }
  throwIfErasureFailed(failures);
};
