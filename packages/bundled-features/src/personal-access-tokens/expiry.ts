import { Temporal } from "@cosmicdrift/kumiko-types/temporal";

export function isExpiredAt(expiresAt: { epochMilliseconds: number } | null): boolean {
  return (
    expiresAt !== null && expiresAt.epochMilliseconds <= Temporal.Now.instant().epochMilliseconds
  );
}
