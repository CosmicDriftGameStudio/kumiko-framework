import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
import { append } from "../../event-store/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import {
  configureEntityFieldEncryption,
  resetEntityFieldEncryptionCacheForTests,
} from "../entity-field-encryption.ts";
import { createEventStoreExecutor } from "../event-store-executor.ts";
import { buildEventMetadata } from "../event-store-executor-context.ts";
import { buildEntityTable } from "../table-builder.ts";

const noteEntity = createEntity({
  table: "read_vc_http_notes",
  fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
  softDelete: true,
});
const noteTable = buildEntityTable("note", noteEntity);

const vaultEntity = createEntity({
  table: "read_vc_http_vaults",
  fields: {
    secret: createTextField({ personal: false, reason: "test_fixture", encrypted: true }),
  },
  softDelete: true,
});
const vaultTable = buildEntityTable("vault", vaultEntity);

const noteFeature = defineFeature("vchttp", (r) => {
  r.entity({ name: "note", ...noteEntity });
  r.entity({ name: "vault", ...vaultEntity });
  const vaultExecutor = createEventStoreExecutor(vaultTable, vaultEntity, { entityName: "vault" });
  r.writeHandler({
    name: "vault:create",
    schema: z.object({ secret: z.string() }),
    handler: async (event, ctx) => vaultExecutor.create(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });
  r.writeHandler({
    name: "vault:update",
    schema: z.object({ id: z.uuid(), version: z.number(), secret: z.string() }),
    handler: async (event, ctx) =>
      vaultExecutor.update(
        {
          id: event.payload.id,
          version: event.payload.version,
          changes: { secret: event.payload.secret },
        },
        event.user,
        ctx.db,
      ),
    access: { roles: ["Admin"] },
  });
  const executor = createEventStoreExecutor(noteTable, noteEntity, { entityName: "note" });

  r.writeHandler({
    name: "note:create",
    schema: z.object({ title: z.string() }),
    handler: async (event, ctx) => executor.create(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });
  r.writeHandler({
    name: "note:update",
    schema: z.object({ id: z.uuid(), version: z.number(), title: z.string() }),
    handler: async (event, ctx) =>
      executor.update(
        {
          id: event.payload.id,
          version: event.payload.version,
          changes: { title: event.payload.title },
        },
        event.user,
        ctx.db,
      ),
    access: { roles: ["Admin"] },
  });
});

type ErrorBody = {
  readonly error: { readonly code: string; readonly details: Record<string, unknown> };
};

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [noteFeature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
  await unsafeCreateEntityTable(stack.db, vaultEntity, "vault");
});

afterAll(async () => {
  resetEntityFieldEncryptionCacheForTests();
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, ["read_vc_http_notes", "read_vc_http_vaults"]);
});

describe("version_conflict over HTTP reports the real versions", () => {
  test("update with a stale version → 409 with expectedVersion 1 and currentVersion 2", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "vchttp:write:note:create",
      { title: "v1" },
      admin,
    );
    await stack.http.writeOk("vchttp:write:note:update", { id, version: 1, title: "v2" }, admin);

    const res = await stack.http.write(
      "vchttp:write:note:update",
      { id, version: 1, title: "stale" },
      admin,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("version_conflict");
    expect(body.error.details).toMatchObject({
      entityId: id,
      expectedVersion: 1,
      currentVersion: 2,
    });
  });

  test("update losing the append race (stream moves between version read and append) → 409 with the post-race currentVersion", async () => {
    const cipher = createTestEnvelopeCipher(
      Buffer.from("a]bJm#kP9xQ2@wN!vL$hR5yT8eU0iO3f").toString("base64"),
    );
    let competingAppend: (() => Promise<void>) | undefined;
    // The update encrypts `previous` after reading the stream version and before appending,
    // so a competing append landing in the hook is a deterministic lost race.
    configureEntityFieldEncryption({
      decrypt: (stored, scope) => cipher.decrypt(stored, scope),
      encrypt: async (plaintext, scope) => {
        const race = competingAppend;
        competingAppend = undefined;
        await race?.();
        return cipher.encrypt(plaintext, scope);
      },
    });
    const { id } = await stack.http.writeOk<{ id: string }>(
      "vchttp:write:vault:create",
      { secret: "s1" },
      admin,
    );
    competingAppend = async () => {
      await append(stack.db, {
        aggregateId: id,
        aggregateType: "vault",
        tenantId: admin.tenantId,
        expectedVersion: 1,
        type: "vault.competing",
        payload: {},
        metadata: buildEventMetadata(admin),
      });
    };

    const res = await stack.http.write(
      "vchttp:write:vault:update",
      { id, version: 1, secret: "s2" },
      admin,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("version_conflict");
    expect(body.error.details).toMatchObject({
      entityId: id,
      expectedVersion: 1,
      currentVersion: 2,
    });
  });
});
