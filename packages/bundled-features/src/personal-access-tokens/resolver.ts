import type { TokenVerifier } from "@cosmicdrift/kumiko-framework/api";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { resolveLiveTenantRoles } from "../tenant/index.ts";
import { isExpiredAt } from "./expiry.ts";
import { hashPatToken } from "./hash.ts";
import { parseScopeNames } from "./parse-scope-names.ts";
import { apiTokenTable } from "./schema/api-token.ts";
import { expandScopes, type PatScopeConfig } from "./web/scopes.ts";

// Hot-path resolver — raw-DB like session-callbacks (a dispatcher roundtrip on
// every request buys nothing here). Hash the bearer token, point-read the row,
// reject revoked/expired, resolve LIVE roles, expand granted scopes into
// allowedQns. Any failure returns null so the middleware answers a uniform 401
// with no oracle about which check failed.
export function createPatResolver(opts: {
  readonly db: DbConnection;
  readonly scopes: PatScopeConfig;
}): TokenVerifier {
  const { db, scopes } = opts;
  return async (rawToken: string): Promise<SessionUser | null> => {
    const row = await fetchOne<{
      id: string;
      userId: string;
      tenantId: string;
      scopes: string;
      revokedAt: unknown;
      expiresAt: { epochMilliseconds: number } | null;
    }>(db, apiTokenTable, { tokenHash: hashPatToken(rawToken) });
    if (!row) return null;
    if (row.revokedAt !== null) return null;
    if (isExpiredAt(row.expiresAt)) return null;
    const live = await resolveLiveTenantRoles(db, row.userId, row.tenantId);
    // Blocked, removed and unknown principals all get the same 401 as an unknown token: no status oracle.
    if (live.kind !== "active") return null;
    const granted = parseScopeNames(row.scopes);
    return {
      id: row.userId,
      // @cast-boundary db-row → branded id: stored from a valid SessionUser.tenantId at create
      tenantId: row.tenantId as TenantId,
      roles: live.roles,
      pat: { tokenId: row.id, scopes: granted, allowedQns: expandScopes(scopes, granted) },
    };
  };
}
