import {
  buildBaseColumns,
  instant,
  integer,
  jsonb,
  table,
  text,
  uniqueIndex,
} from "@kumiko/framework/db";
import { createEntity, createNumberField, createTextField } from "@kumiko/framework/engine";
import { sql } from "drizzle-orm";

// Envelope stored as a single jsonb blob. All ops are upsert-by-(tenantId, key)
// so there's no value in decomposing the envelope into separate columns —
// we never query or index on any sub-field of the envelope itself.
//
// kekVersion IS broken out as its own column so the rotation job can filter
// `WHERE kek_version != currentVersion()` with an index on just that column
// without deserializing the jsonb. Duplicated inside envelope too — the two
// always stay in sync via the write path.
export type StoredEnvelope = {
  readonly ciphertext: string; // base64
  readonly iv: string; // base64
  readonly authTag: string; // base64
  readonly encryptedDek: string; // base64
  readonly kekVersion: number;
};

export type StoredMetadata = {
  readonly redactedPreview?: string;
  readonly hint?: string;
};

// Entity registration for the ES pivot. Only `key` + `kekVersion` are
// declared as business-validated fields; the jsonb columns (envelope,
// metadata) and the instant column (lastRotatedAt) ride along as extra
// table-columns. The executor writes whatever keys land in `flatData`
// into both the projection row AND the event payload, so the whole
// envelope round-trips through events.
//
// The envelope is cipher-safe by construction (AES-GCM ciphertext + authTag
// + DEK encrypted under the KEK). A leaked event row can't recover the
// plaintext without the master key — so shipping it into the events-table
// doesn't weaken the threat model vs. the pre-ES tenant_secrets column.
export const tenantSecretEntity = createEntity({
  table: "read_tenant_secrets",
  fields: {
    key: createTextField({ required: true }),
    kekVersion: createNumberField({ required: true }),
  },
});

export const tenantSecretsTable = table(
  "read_tenant_secrets",
  {
    ...buildBaseColumns(false, "uuid"),
    key: text("key").notNull(),
    envelope: jsonb("envelope").$type<StoredEnvelope>().notNull(),
    kekVersion: integer("kek_version").notNull(),
    metadata: jsonb("metadata").$type<StoredMetadata>().default({}).notNull(),
    lastRotatedAt: instant("last_rotated_at").default(sql`now()`).notNull(),
  },
  (t) => [uniqueIndex("read_tenant_secrets_tenant_key_unique").on(t.tenantId, t.key)],
);
