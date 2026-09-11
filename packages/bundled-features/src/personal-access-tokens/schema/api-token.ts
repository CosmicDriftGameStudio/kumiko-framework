import { deriveEntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
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
      personal: false,
      reason: "pseudonymous_fk",
    }),
    tenantId: createTextField({
      required: true,
      maxLength: 36,
      access: { write: access.privileged },
      personal: false,
      reason: "pseudonymous_fk",
    }),
    name: createTextField({
      required: true,
      maxLength: 120,
      access: { write: access.privileged },
      personal: { of: "userId" },
      find: "none",
    }),
    // SHA-256 hash of the plaintext token — credential material, but kept
    // Klasse 1 deliberately: resolver.ts point-reads this row with a raw
    // exact-match `{ tokenHash: hashPatToken(rawToken) }` query on the hot
    // auth path. A subject annotation here would make encryptForDirectWrite
    // store ciphertext while the resolver keeps querying for the plaintext
    // hash — every bearer-token request would 401 once a KMS is active.
    // Fixing that needs a blind-index-backed lookup (like email's
    // find:"exact" companion column), a resolver.ts rewrite out of scope
    // here — see PR body "Offene Fragen".
    tokenHash: createTextField({
      required: true,
      maxLength: 64,
      access: { write: access.privileged },
      personal: false,
      reason: "credential_hash_used_as_exact_lookup_key_2809",
    }),
    // Short displayable prefix ("your tokens" list) — not the secret itself,
    // but still identifies which of the user's tokens this row is. Kept
    // Klasse 1: list.query.ts returns `r.prefix` straight through with no
    // decrypt call (unlike `name`, which goes through decryptStoredPii) — a
    // subject annotation would leak ciphertext to the UI once a KMS is
    // active. See PR body "Offene Fragen".
    prefix: createTextField({
      required: true,
      maxLength: 16,
      access: { write: access.privileged },
      personal: false,
      reason: "credential_prefix_read_without_decrypt_2809",
    }),
    // JSON-encoded string[] of granted scope names — mirrors the roles-column
    // convention (parseRoles-style text); the resolver JSON.parses it.
    scopes: createTextField({
      required: true,
      access: { write: access.privileged },
      personal: false,
      reason: "technical_reference",
    }),
    createdAt: createTimestampField({ required: true, access: { write: access.privileged } }),
    expiresAt: createTimestampField({ access: { write: access.privileged } }),
    revokedAt: createTimestampField({ access: { write: access.privileged } }),
  },
  indexes: [{ unique: true, columns: ["tokenHash"], name: "store_api_tokens_hash_unique" }],
});

// deriveEntityTableMeta (not buildEntityTable): this is a direct-write store, so
// the table must be a WritableTable (post ES-write-brand #742) — same as
// sessions' userSessionTable. buildEntityTable is branded executor-only.
export const apiTokenTable = deriveEntityTableMeta("api-token", apiTokenEntity, {
  source: "unmanaged",
});
