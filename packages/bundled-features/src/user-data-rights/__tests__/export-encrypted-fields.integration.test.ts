// Art. 20 + encrypted entity fields: export hooks read raw rows past the
// executor's decrypt layer, so runUserExport must decrypt encrypted fields
// centrally — plaintext with a configured cipher, an explicit marker
// (never the raw ciphertext) without one.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  buildEntityTable,
  configureEntityFieldEncryption,
  resetEntityFieldEncryptionCacheForTests,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
  EXT_USER_DATA,
  type UserDataExportHook,
} from "@cosmicdrift/kumiko-framework/engine";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createDataRetentionFeature } from "../../data-retention";
import { createSessionsFeature } from "../../sessions";
import { createUserFeature } from "../../user";
import { createUserDataRightsFeature } from "../feature";
import { runUserExport } from "../run-user-export";

const TENANT = "00000000-0000-4000-8000-00000000000a";
const USER_ID = "cccccccc-cccc-4ccc-8ccc-000000000001";
const PLAINTEXT_NOTE = "my private vault note";

const cipher = createTestEnvelopeCipher();

const vaultNoteEntity = createEntity({
  table: "read_vault_notes",
  fields: {
    ownerId: createTextField({ required: true }),
    note: createTextField({ encrypted: true }),
  },
});

const vaultNotesTableRef = buildEntityTable("vault-note", vaultNoteEntity);

// Export hook mirrors real hooks (folders-user-data pattern): raw select,
// no decrypt of its own.
const vaultExportHook: UserDataExportHook = async (ctx) => {
  const rows = await selectMany<Record<string, unknown>>(ctx.db, vaultNotesTableRef, {
    ownerId: ctx.userId,
  });
  if (rows.length === 0) return null;
  return { entity: "vault-note", rows };
};

const vaultFeature = defineFeature("vault", (r) => {
  const entity = r.entity("vault-note", vaultNoteEntity);
  r.useExtension(EXT_USER_DATA, entity, {
    export: vaultExportHook,
    delete: async () => undefined,
  });
});

let stack: TestStack;
let registry: ReturnType<typeof createRegistry>;

beforeAll(async () => {
  stack = await setupTestStack({ features: [] });
  // user-data-rights hosts EXT_USER_DATA — without it the vault feature's
  // useExtension reference fails registry creation. Its hard requires
  // (user/data-retention/compliance-profiles/sessions) come along.
  registry = createRegistry([
    createUserFeature(),
    createDataRetentionFeature(),
    createComplianceProfilesFeature(),
    createSessionsFeature(),
    createUserDataRightsFeature(),
    vaultFeature,
  ]);

  await asRawClient(stack.db).unsafe(`
    CREATE TABLE IF NOT EXISTS read_tenant_memberships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      user_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      inserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      inserted_by_id TEXT,
      modified_by_id TEXT,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      deleted_at TIMESTAMPTZ,
      deleted_by_id TEXT,
      roles TEXT NOT NULL DEFAULT '[]',
      UNIQUE(user_id, tenant_id)
    )
  `);
  await asRawClient(stack.db).unsafe(
    `INSERT INTO read_tenant_memberships (tenant_id, user_id) VALUES ('${TENANT}', '${USER_ID}')
     ON CONFLICT DO NOTHING`,
  );

  await asRawClient(stack.db).unsafe(`
    CREATE TABLE IF NOT EXISTS read_vault_notes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      inserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      inserted_by_id TEXT,
      modified_by_id TEXT,
      owner_id TEXT NOT NULL,
      note TEXT
    )
  `);
  const storedNote = await cipher.encrypt(PLAINTEXT_NOTE);
  await asRawClient(stack.db).unsafe(
    `INSERT INTO read_vault_notes (tenant_id, owner_id, note) VALUES ('${TENANT}', '${USER_ID}', '${storedNote.replaceAll("'", "''")}')`,
  );
});

afterEach(() => {
  resetEntityFieldEncryptionCacheForTests();
});

afterAll(async () => {
  await stack.cleanup();
});

async function exportedNote(): Promise<unknown> {
  const bundle = await runUserExport({
    db: stack.db,
    registry,
    userId: USER_ID,
    now: getTemporal().Now.instant(),
  });
  const snippet = bundle.tenants.flatMap((t) => t.entities).find((e) => e.entity === "vault-note");
  return snippet?.rows[0]?.["note"];
}

describe("user export with encrypted entity fields", () => {
  test("decrypts encrypted fields when the cipher is configured", async () => {
    configureEntityFieldEncryption(cipher);
    expect(await exportedNote()).toBe(PLAINTEXT_NOTE);
  });

  test("exports an explicit marker — never ciphertext — without a cipher", async () => {
    const value = await exportedNote();
    expect(value).toBe("[encrypted:unavailable]");
  });
});
