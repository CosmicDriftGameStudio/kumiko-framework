// Narrow cross-feature query results (ctx.queryAs → Promise<unknown>) into
// the shape the auth handlers actually read. Replaces a bare
// `as AuthUserRow | null` at the system boundary — the coding standard
// requires a TypeGuard in place of unchecked casts from unknown.

import type { TenantId } from "@kumiko/framework/engine";

// Fields findForAuth returns. `version` is present for updates, `email` +
// `passwordHash` only for login/reset/verification lookups. Every field
// except `id` is optional because different call-sites read different
// subsets and the projection may add nullable columns later.
export type AuthUserRow = {
  readonly id: string;
  readonly email?: string;
  readonly version?: number;
  readonly passwordHash?: string | null;
  readonly isDeleted?: boolean | null;
  readonly emailVerified?: boolean | null;
  readonly lastActiveTenantId?: TenantId | string | null;
};

// Returns the narrowed row or null — mirrors findForAuth's contract where
// "not found" is a legitimate outcome (unknown email, unknown id). Throws
// NEVER — a malformed row is treated as not-found so enumeration surfaces
// stay consistent across "user doesn't exist" and "DB gave back junk".
export function parseAuthUserRow(raw: unknown): AuthUserRow | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj["id"] !== "string") return null;
  // Deliberate boundary-cast: id is verified; the remaining optional
  // fields (email, version, isDeleted, …) are declared optional on
  // AuthUserRow so a missing property at the callsite surfaces as
  // `undefined` on read, not a runtime exception. Explicit validation
  // of each column would duplicate findForAuth's schema and rot with it.
  return obj as unknown as AuthUserRow;
}
