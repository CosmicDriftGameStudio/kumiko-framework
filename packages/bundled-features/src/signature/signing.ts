import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { signerExecutor } from "./entity.ts";
import { type GeneratedFileContext, storeGeneratedFile } from "./files.ts";
import { type SignerRow, versionOf } from "./lib.ts";
import { checkSignaturePng, decodeSignaturePngBase64 } from "./png.ts";
import {
  SIGNATURE_INVALID_IMAGE_REASON,
  SIGNATURE_SIGNER_STATUS,
  type SignatureMethod,
} from "./web/constants.ts";

export function invalidImage() {
  return writeFailure(new UnprocessableError(SIGNATURE_INVALID_IMAGE_REASON));
}

export function decodeSignatureImage(imagePngBase64: string): Uint8Array | null {
  const bytes = decodeSignaturePngBase64(imagePngBase64);
  if (bytes === null) return null;
  return checkSignaturePng(bytes).ok ? bytes : null;
}

// IP and user agent come from the HTTP request, not from the payload, so a client cannot choose them.
export function auditValuesOfRequest(): Record<string, string> {
  const scope = requestContext.get();
  return {
    ...(scope?.ip !== undefined && { signedFromIp: scope.ip }),
    ...(scope?.userAgent !== undefined && { signedUserAgent: scope.userAgent }),
  };
}

export type SignatureWrite = {
  readonly method: SignatureMethod;
  readonly imageFileId: string;
  readonly signedAt: Temporal.Instant;
};

export function signatureChanges(write: SignatureWrite): Record<string, unknown> {
  return {
    status: SIGNATURE_SIGNER_STATUS.Signed,
    method: write.method,
    signedAt: write.signedAt,
    imageFileId: write.imageFileId,
    linkAnchor: null,
    ...auditValuesOfRequest(),
  };
}

export async function storeSignatureImage(
  ctx: GeneratedFileContext,
  user: SessionUser,
  png: Uint8Array,
) {
  return storeGeneratedFile(ctx, user, {
    fileName: "signature.png",
    mimeType: "image/png",
    data: png,
  });
}

// Records the signature of an in-person signer. A concurrent change of the row makes the executor
// refuse the stale version, so a double submit signs once.
export function recordInPersonSignature(
  ctx: { readonly db: TenantDb },
  user: SessionUser,
  signer: SignerRow,
  write: SignatureWrite,
) {
  return signerExecutor.update(
    { id: signer.id, version: versionOf(signer), changes: signatureChanges(write) },
    user,
    ctx.db,
  );
}
