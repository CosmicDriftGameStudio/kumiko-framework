import { instant, integer, jsonb, table, text, uniqueIndex, uuid } from "@kumiko/framework/db";
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

export const tenantSecretsTable = table(
  "tenant_secrets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull(),
    key: text("key").notNull(),
    envelope: jsonb("envelope").$type<StoredEnvelope>().notNull(),
    kekVersion: integer("kek_version").notNull(),
    metadata: jsonb("metadata").$type<StoredMetadata>().default({}).notNull(),
    lastRotatedAt: instant("last_rotated_at").default(sql`now()`).notNull(),
    createdAt: instant("created_at").default(sql`now()`).notNull(),
    updatedAt: instant("updated_at"),
    updatedById: text("updated_by_id"),
  },
  (t) => [uniqueIndex("tenant_secrets_tenant_key_unique").on(t.tenantId, t.key)],
);

// Per-read audit trail. A row is appended every time feature code calls
// ctx.secrets.get — never the value, just "who read what when from where".
// Required by compliance regimes (SOC2, ISO 27001) that mandate provable
// access logs on credential material. Rows are append-only in practice;
// no UPDATE/DELETE path ships in v1.
export const tenantSecretsAuditTable = table("tenant_secret_reads", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  // Secret key that was read. Matches tenant_secrets.key — no FK constraint
  // because a read of a now-deleted secret is still a legitimate audit row
  // (someone touched it before the delete).
  key: text("key").notNull(),
  userId: text("user_id").notNull(),
  // Qualified handler name ("billing:write:charge"). Lets ops answer
  // "which code paths touch this secret?" with a SQL GROUP BY.
  handlerName: text("handler_name").notNull(),
  readAt: instant("read_at").default(sql`now()`).notNull(),
});
