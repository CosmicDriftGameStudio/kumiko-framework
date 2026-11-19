// Pins the purpose so a flow can only sign and verify its own tokens.

import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { signToken, TokenPurpose, type VerifyResult, verifyToken } from "../shared/index.ts";

export function signResetToken(
  userId: string,
  ttlMinutes: number,
  secret: string,
  now?: Temporal.Instant,
): ReturnType<typeof signToken> {
  return signToken(userId, TokenPurpose.passwordReset, ttlMinutes, secret, now);
}

export function verifyResetToken(
  token: string,
  secret: string,
  now?: Temporal.Instant,
): VerifyResult {
  return verifyToken(token, TokenPurpose.passwordReset, secret, now);
}
