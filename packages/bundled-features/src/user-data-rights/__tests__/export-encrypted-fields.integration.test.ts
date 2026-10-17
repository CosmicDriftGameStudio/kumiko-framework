// Art. 20 + encrypted entity fields: export hooks read raw rows past the
// executor's decrypt layer, so runUserExport must decrypt encrypted fields
// centrally — plaintext with a configured cipher, an explicit marker
// (never the raw ciphertext) without one.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";

import {
  asRawClient,
  buildEntityTable,
  configureEntityFieldEncryption,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
  EXT_USER_DATA,
  type UserDataExportHook,
} from "@cosmicdrift/kumiko-framework/engine";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  createTestEnvelopeCipher,
  resetEntityFieldEncryptionCacheForTests,
  seedRow,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.js";
import { createDataRetentionFeature } from "../../data-retention/index.js";
import { createSessionsFeature } from "../../sessions/index.js";
import { tenantMembershipEntity, tenantMembershipsTable } from "../../tenant/membership-table.js";
import { createUserFeature } from "../../user/index.js";
import { createUserDataRightsFeature } from "../feature.js";
import { runUserExport } from "../run-user-export.js";

const TENANT = "00000000-0000-4000-8000-00000000000a";
const USER_ID = "cccccccc-cccc-4ccc-8ccc-000000000001";
const PLAINTEXT_NOTE = "my private vault note";
const PLAINTEXT_API_KEY = "sk-live-export-secret-0001";

const cipher = createTestEnvelopeCipher();

const vaultNoteEntity = createEntity({
  table: "read_vault_notes",
  fields: {
    ownerId: createTextField({ required: true, personal: false, reason: "pseudonymous_fk" }),
    note: createTextField({ encrypted: true, personal: false, reason: "technical_reference" }),
    apiKey: createTextField({ personal: "tenant", find: "secret", writeOnly: true }),
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
  const entity = r.entity({ name: "vault-note", ...vaultNoteEntity });
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
    authFoundationFeature,
    createSessionsFeature(),
    createUserDataRightsFeature(),
    vaultFeature,
  ]);

  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
  await seedRow(stack.db, tenantMembershipsTable, {
    tenantId: TENANT,
    userId: USER_ID,
    roles: "[]",
  });

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
      note TEXT,
      api_key TEXT
    )
  `);
  const storedNote = await cipher.encrypt(PLAINTEXT_NOTE);
  const storedApiKey = await cipher.encrypt(PLAINTEXT_API_KEY);
  await asRawClient(stack.db).unsafe(
    `INSERT INTO read_vault_notes (tenant_id, owner_id, note, api_key) VALUES ('${TENANT}', '${USER_ID}', '${storedNote.replaceAll("'", "''")}', '${storedApiKey.replaceAll("'", "''")}')`,
  );
});

afterEach(() => {
  resetEntityFieldEncryptionCacheForTests();
});

afterAll(async () => {
  await stack.cleanup();
});

async function exportedNote(field = "note"): Promise<unknown> {
  const bundle = await runUserExport({
    db: stack.db,
    registry,
    userId: USER_ID,
    now: getTemporal().Now.instant(),
  });
  const snippet = bundle.tenants.flatMap((t) => t.entities).find((e) => e.entity === "vault-note");
  return snippet?.rows[0]?.[field];
}

describe("user export with encrypted entity fields", () => {
  test("decrypts encrypted fields when the cipher is configured", async () => {
    configureEntityFieldEncryption(cipher);
    expect(await exportedNote()).toBe(PLAINTEXT_NOTE);
  });

  test("a writeOnly field exports as true, never the decrypted plaintext", async () => {
    configureEntityFieldEncryption(cipher);
    expect(await exportedNote("apiKey")).toBe(true);
  });

  test("exports an explicit marker — never ciphertext — without a cipher", async () => {
    const value = await exportedNote();
    expect(value).toBe("[encrypted:unavailable]");
  });
});
