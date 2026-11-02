import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const FILE_CLAIM_BYTES = 32;

function hashFileClaim(claim: string): Buffer {
  return createHash("sha256").update(claim).digest();
}

/** `claimHash` is what the fileRef row stores; the claim itself only ever leaves in the upload response. */
export function generateFileClaim(): { readonly claim: string; readonly claimHash: string } {
  const claim = randomBytes(FILE_CLAIM_BYTES).toString("base64url");
  return { claim, claimHash: hashFileClaim(claim).toString("hex") };
}

export function fileClaimMatches(storedClaimHash: unknown, claim: string): boolean {
  if (typeof storedClaimHash !== "string") return false;
  const stored = Buffer.from(storedClaimHash, "hex");
  const presented = hashFileClaim(claim);
  return stored.length === presented.length && timingSafeEqual(stored, presented);
}
