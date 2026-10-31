import { createHash } from "node:crypto";

export function hasLeadingZeroBits(hash: Uint8Array, bits: number): boolean {
  const fullBytes = Math.floor(bits / 8);
  for (let index = 0; index < fullBytes; index++) {
    if (hash[index] !== 0) return false;
  }
  const remainingBits = bits % 8;
  if (remainingBits === 0) return true;
  const next = hash[fullBytes];
  if (next === undefined) return false;
  return next >> (8 - remainingBits) === 0;
}

export function verifyProofOfWork(args: {
  readonly challenge: string;
  readonly nonce: string;
  readonly bits: number;
}): boolean {
  const hash = createHash("sha256").update(`${args.challenge}:${args.nonce}`).digest();
  return hasLeadingZeroBits(hash, args.bits);
}
