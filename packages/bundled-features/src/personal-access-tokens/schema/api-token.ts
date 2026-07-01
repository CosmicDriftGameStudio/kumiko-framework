import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createEntity,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

// One row per Personal Access Token. Like read_user_sessions this is a
// direct-write store (r.unmanagedTable): the create/revoke handlers write it and
// the resolver point-reads it on the hot auth path. `tokenHash` is the SHA-256
// of the plaintext (never the plaintext); the unique index on it makes the
// resolver a single point-read. All columns are privileged-write so no user
// request can forge ownership/scope/hash by poking a field directly — the
// handlers mutate them via ctx.db inside the pipeline.
export const apiTokenEntity = createEntity({
  table: "read_api_tokens",
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
    name: createTextField({ required: true, maxLength: 120, access: { write: access.privileged } }),
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
  indexes: [{ unique: true, columns: ["tokenHash"], name: "read_api_tokens_hash_unique" }],
});

export const apiTokenTable = buildEntityTable("api-token", apiTokenEntity);
