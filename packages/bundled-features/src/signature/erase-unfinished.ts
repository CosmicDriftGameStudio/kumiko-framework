import { PII_ERASED_SENTINEL } from "@cosmicdrift/kumiko-framework/crypto";
import type { JobContext } from "@cosmicdrift/kumiko-framework/engine";
import { computeCutoff } from "../data-retention/index.ts";
import type { SignatureRetention } from "./entity.ts";
import { isPastInstant, listSigners, type SignerRow } from "./lib.ts";
import { forEachRequestPageWithStatus } from "./sweep.ts";
import { ANONYMIZED_SIGNER_NAME, eraseSignerRows, signerEraseContext } from "./user-data.ts";
import { SIGNATURE_REQUEST_STATUS } from "./web/constants.ts";

const UNFINISHED_REQUEST_STATUSES = [
  SIGNATURE_REQUEST_STATUS.Declined,
  SIGNATURE_REQUEST_STATUS.Expired,
  SIGNATURE_REQUEST_STATUS.Failed,
  SIGNATURE_REQUEST_STATUS.Cancelled,
] as const;

// Anonymized and key-shredded signers read back as the anonymized name or the erased sentinel.
function isErasedSigner(signer: SignerRow): boolean {
  return (
    signer.name === null ||
    signer.name === ANONYMIZED_SIGNER_NAME ||
    signer.name === PII_ERASED_SENTINEL
  );
}

// No contract came about, so Art. 17(3)(e) does not hold the signers' data for keepFor.
// ponytail: scans every unfinished request daily; mark erased requests if that list grows large.
export async function eraseSignersOfUnfinishedRequests(
  ctx: JobContext,
  retention: SignatureRetention,
): Promise<void> {
  const cutoff = computeCutoff(retention.unfinishedKeepFor, ctx.tz.now());
  const eraseCtx = signerEraseContext(ctx, ctx.systemUser);
  for (const status of UNFINISHED_REQUEST_STATUSES) {
    await forEachRequestPageWithStatus(ctx, status, async (requests) => {
      for (const request of requests) {
        if (!isPastInstant(request.modifiedAt, cutoff)) continue;
        const signers = (await listSigners(ctx, ctx.systemUser, request.id)).filter(
          (signer) => !isErasedSigner(signer),
        );
        if (signers.length > 0) await eraseSignerRows(eraseCtx, signers, "anonymize");
      }
    });
  }
}
