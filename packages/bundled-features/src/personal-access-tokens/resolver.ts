import type { TokenVerifier } from "@cosmicdrift/kumiko-framework/api";
import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "temporal-polyfill";
import { hashPatToken } from "./hash";
import { resolvePatRoles } from "./roles";
import { apiTokenTable } from "./schema/api-token";
import { expandScopes, type PatScopeConfig } from "./scopes";

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
    if (
      row.expiresAt &&
      row.expiresAt.epochMilliseconds <= Temporal.Now.instant().epochMilliseconds
    ) {
      return null;
    }
    const roles = await resolvePatRoles(db, row.userId, row.tenantId);
    if (!roles) return null;
    const granted = parseScopeNames(row.scopes);
    return {
      id: row.userId,
      // @cast-boundary db-row → branded id: stored from a valid SessionUser.tenantId at create
      tenantId: row.tenantId as TenantId,
      roles,
      pat: { tokenId: row.id, scopes: granted, allowedQns: expandScopes(scopes, granted) },
    };
  };
}

function parseScopeNames(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}
