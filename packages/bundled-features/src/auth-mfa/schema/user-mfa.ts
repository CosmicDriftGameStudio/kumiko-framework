import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

// One row per (userId, tenantId) — presence of a row IS "MFA enabled" for
// that user. Event-sourced (not unmanagedTable): enable/disable/regenerate
// are rare, auditable state changes, not a hot-path lookup like sessions —
// mfa.enabled/disabled fall out of the event stream instead of being
// manually emitted.
export const userMfaEntity = createEntity({
  table: "read_user_mfa",
  fields: {
    // FK to the user row, not content — PII-naming heuristic would flag
    // "userId" as content; it's a pseudonymous reference, matching the same
    // annotation `config`'s userId column uses.
    userId: createTextField({ required: true, allowPlaintext: "pseudonymous-fk" }),
    // Envelope-encrypted via the same MasterKeyProvider as secrets/config
    // (entity-field-encryption.ts) — no manual wrapDek/unwrapDek needed.
    // userOwned: crypto-shredding this field is exactly "revoke this
    // user's 2FA on GDPR forget", which is the correct behavior anyway.
    totpSecret: createTextField({
      required: true,
      encrypted: true,
      userOwned: { ownerField: "userId" },
    }),
    // JSON-stringified `{ hashes: string[] }` (argon2id hashes of unredeemed
    // recovery codes) — both encryption layers (entity-field envelope +
    // per-subject crypto-shred, same as totpSecret above) require a string
    // value, so callers JSON.stringify on write and JSON.parse on read
    // (see db/queries.ts's findUserMfaRow) rather than storing jsonb here.
    // A redeemed code's hash is removed from the array (see disable/regen
    // handlers), so array length also IS the remaining-codes count.
    // No jsonb->text migration: zero-legacy/single-user framework repo, no
    // production user_mfa rows exist to backfill (delete-and-re-enroll is
    // the upgrade path for anyone who hit the old jsonb shape locally).
    recoveryCodes: createTextField({
      required: true,
      encrypted: true,
      userOwned: { ownerField: "userId" },
    }),
    enabledAt: createTimestampField({ required: true }),
    lastUsedAt: createTimestampField(),
  },
  indexes: [{ unique: true, columns: ["userId", "tenantId"], name: "read_user_mfa_user_unique" }],
});

export const userMfaTable = buildEntityTable("user-mfa", userMfaEntity);
