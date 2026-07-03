import { deleteMany, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { UserDataDeleteHook, UserDataExportHook } from "@cosmicdrift/kumiko-framework/engine";
import { userSessionTable } from "../../sessions";
import { featureMounted } from "./feature-mounted";

// userData-Hooks for the sessions feature's user-session rows (ip, userAgent).
//
// user-session is an unmanaged direct-write store (no event stream, excluded
// from projection rebuilds — see sessions/feature.ts #494/#498), so a direct
// DELETE is legal here and survives rebuilds; the executor path the ES
// entities use does not apply.
//
// Both forget strategies hard-delete: a session row without its user is
// worthless (revocation audit trail loses its subject), and ip/userAgent are
// pure PII with no shared-data value to preserve via anonymization.

export const userSessionExportHook: UserDataExportHook = async (ctx) => {
  if (!featureMounted(ctx, "sessions")) return null;
  const rows = await selectMany<Record<string, unknown>>(ctx.db, userSessionTable, {
    userId: ctx.userId,
    tenantId: ctx.tenantId,
  });
  if (rows.length === 0) return null;
  return {
    entity: "user-session",
    // sid (row id) stays out of the bundle — it is the JWT jti and
    // token-shaped, not portable personal data.
    rows: rows.map((r) => ({
      createdAt: String(r["createdAt"] ?? ""),
      expiresAt: String(r["expiresAt"] ?? ""),
      revokedAt: r["revokedAt"] ? String(r["revokedAt"]) : null,
      ip: r["ip"] ?? null,
      userAgent: r["userAgent"] ?? null,
    })),
  };
};

export const userSessionDeleteHook: UserDataDeleteHook = async (ctx) => {
  if (!featureMounted(ctx, "sessions")) return;
  await deleteMany(ctx.db, userSessionTable, { userId: ctx.userId, tenantId: ctx.tenantId });
};
