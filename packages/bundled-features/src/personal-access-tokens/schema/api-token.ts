import { buildEntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createEntity,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

// One row per Personal Access Token. Like store_user_sessions this is a
// direct-write store (r.unmanagedTable): the create/revoke handlers write it and
// the resolver point-reads it on the hot auth path. `tokenHash` is the SHA-256
// of the plaintext (never the plaintext); the unique index on it makes the
// resolver a single point-read. All columns are privileged-write so no user
// request can forge ownership/scope/hash by poking a field directly — the
// handlers mutate them via ctx.db inside the pipeline.
export const apiTokenEntity = createEntity({
  table: "store_api_tokens",
  // No softDelete: revocation is its own lifecycle (revokedAt timestamp), and
  // we keep revoked rows for the "your tokens" audit list.
  softDelete: false,
  fields: {
    userId: createTextField({
      required: true,
      maxLength: 36,
      access: { write: access.privileged },
    }),
    tenantId: createTextField({
      required: true,
      maxLength: 36,
      access: { write: access.privileged },
    }),
    name: createTextField({
      required: true,
      maxLength: 120,
      access: { write: access.privileged },
      userOwned: { ownerField: "userId" },
    }),
    tokenHash: createTextField({
      required: true,
      maxLength: 64,
      access: { write: access.privileged },
    }),
    prefix: createTextField({
      required: true,
      maxLength: 16,
      access: { write: access.privileged },
    }),
    // JSON-encoded string[] of granted scope names — mirrors the roles-column
    // convention (parseRoles-style text); the resolver JSON.parses it.
    scopes: createTextField({ required: true, access: { write: access.privileged } }),
    createdAt: createTimestampField({ required: true, access: { write: access.privileged } }),
    expiresAt: createTimestampField({ access: { write: access.privileged } }),
    revokedAt: createTimestampField({ access: { write: access.privileged } }),
  },
  indexes: [{ unique: true, columns: ["tokenHash"], name: "store_api_tokens_hash_unique" }],
});

// buildEntityTableMeta (not buildEntityTable): this is a direct-write store, so
// the table must be a WritableTable (post ES-write-brand #742) — same as
// sessions' userSessionTable. buildEntityTable is branded executor-only.
export const apiTokenTable = buildEntityTableMeta("api-token", apiTokenEntity, {
  source: "unmanaged",
});
