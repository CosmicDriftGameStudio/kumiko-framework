import { Temporal } from "temporal-polyfill";

export function isExpiredAt(expiresAt: { epochMilliseconds: number } | null): boolean {
  return (
    expiresAt !== null && expiresAt.epochMilliseconds <= Temporal.Now.instant().epochMilliseconds
  );
}
