import { deleteMany, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { UserDataDeleteHook, UserDataExportHook } from "@cosmicdrift/kumiko-framework/engine";
import { apiTokenTable } from "../../personal-access-tokens";
import { featureMounted } from "./feature-mounted";

// userData-Hooks for personal-access-tokens rows. Same shape as user-session:
// unmanaged direct-write store (no event stream, rebuild-safe DELETE), and a
// token without its user is worthless — both strategies hard-delete. Deleting
// the row also revokes the token (the resolver point-reads this table), which
// is the correct outcome for a forgotten user.

export const apiTokenExportHook: UserDataExportHook = async (ctx) => {
  if (!featureMounted(ctx, "personal-access-tokens")) return null;
  const rows = await selectMany<Record<string, unknown>>(ctx.db, apiTokenTable, {
    userId: ctx.userId,
    tenantId: ctx.tenantId,
  });
  if (rows.length === 0) return null;
  return {
    entity: "api-token",
    // tokenHash stays out of the bundle — secret-derived, not personal data.
    rows: rows.map((r) => ({
      name: r["name"] ?? null,
      prefix: r["prefix"] ?? null,
      scopes: r["scopes"] ?? null,
      createdAt: String(r["createdAt"] ?? ""),
      expiresAt: r["expiresAt"] ? String(r["expiresAt"]) : null,
      revokedAt: r["revokedAt"] ? String(r["revokedAt"]) : null,
    })),
  };
};

export const apiTokenDeleteHook: UserDataDeleteHook = async (ctx) => {
  // skip: personal-access-tokens not mounted — its table doesn't exist, nothing to erase.
  if (!featureMounted(ctx, "personal-access-tokens")) return;
  await deleteMany(ctx.db, apiTokenTable, { userId: ctx.userId, tenantId: ctx.tenantId });
};
