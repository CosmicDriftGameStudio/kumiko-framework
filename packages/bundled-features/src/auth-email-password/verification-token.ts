// Pins the purpose so a flow can only sign and verify its own tokens.

import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { signToken, TokenPurpose, type VerifyResult, verifyToken } from "../shared/index.ts";

export function signVerificationToken(
  userId: string,
  ttlMinutes: number,
  secret: string,
  now?: Temporal.Instant,
): ReturnType<typeof signToken> {
  return signToken(userId, TokenPurpose.emailVerification, ttlMinutes, secret, now);
}

export function verifyVerificationToken(
  token: string,
  secret: string,
  now?: Temporal.Instant,
): VerifyResult {
  return verifyToken(token, TokenPurpose.emailVerification, secret, now);
}
