// Legacy events carry a jsonb personal field as a plaintext object (written before the
// annotation or before a KMS existed). The backfill serializes and encrypts it under the
// owner's key, in created, updated and the `previous` of delete events alike.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetEventStore, setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { resetBlindIndexKeyForTests } from "../../crypto/blind-index.ts";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  decryptPiiFieldValues,
  InMemoryKmsAdapter,
  isPiiCiphertext,
} from "../../crypto/index.ts";
import { resetPiiSubjectKmsForTests } from "../../crypto/pii-field-encryption.ts";
import { buildEntityTable, createEventStoreExecutor } from "../../db/index.ts";
import { asRawClient } from "../../db/query.ts";
import {
  createEntity,
  createJsonbField,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { runPiiEventBackfill } from "../pii-event-backfill.ts";

const TABLE = "read_pii_backfill_drafts";
const admin = TestUsers.admin;
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const BLOB = { values: { name: "Zebulon Quaxford" }, stepIndex: 2 };

const draftEntity = createEntity({
  table: TABLE,
  fields: {
    ownerId: createTextField({ personal: "ref", required: true }),
    blob: createJsonbField({ personal: { of: "ownerId" } }),
  },
});

const draftTable = buildEntityTable("draft", draftEntity);
const draftExecutor = createEventStoreExecutor(draftTable, draftEntity, { entityName: "draft" });

const feature = defineFeature("jbf", (r) => {
  r.entity({ name: "draft", ...draftEntity });
  r.crud("draft", draftEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
  });
  // The API refuses scalars for a jsonb field; legacy events could still carry them.
  r.writeHandler({
    name: "seed-scalar",
    schema: z.object({ blob: z.union([z.string(), z.number()]) }),
    access: { roles: ["Admin"] },
    handler: async (event, ctx) => {
      return draftExecutor.create(
        { ownerId: OWNER_ID, blob: event.payload.blob },
        event.user,
        ctx.db,
      );
    },
  });
});

let stack: TestStack;
const kms = new InMemoryKmsAdapter();

type EventRow = { type: string; payload: Record<string, unknown> };

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetEventStore(stack, [TABLE]);
  await asRawClient(stack.db).unsafe(
    `DROP TABLE IF EXISTS "kumiko_pii_backfill_state", "kumiko_pending_rebuilds"`,
  );
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

async function readEvents(): Promise<readonly EventRow[]> {
  return (await asRawClient(stack.db).unsafe(
    `SELECT "type", "payload" FROM "kumiko_events" ORDER BY "id"`,
  )) as ReadonlyArray<EventRow>;
}

async function decryptBlob(value: unknown): Promise<unknown> {
  const out = await decryptPiiFieldValues({ blob: value }, ["blob"], kms, {
    requestId: "pii-event-backfill-jsonb-test",
  });
  return out["blob"];
}

describe("runPiiEventBackfill with a jsonb personal field", () => {
  test("legacy plaintext objects in created, updated and delete-previous events are encrypted under the owner key", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      "jbf:write:draft:create",
      { ownerId: OWNER_ID, blob: BLOB },
      admin,
    );
    const updated = { ...BLOB, stepIndex: 3 };
    await stack.http.writeOk(
      "jbf:write:draft:update",
      { id: created.id, version: 1, changes: { blob: updated } },
      admin,
    );
    await stack.http.writeOk("jbf:write:draft:delete", { id: created.id }, admin);
    const legacy = await readEvents();
    expect(JSON.stringify(legacy)).toContain("Zebulon Quaxford");

    configureBlindIndexKey(Buffer.alloc(32, 7).toString("base64"));
    configurePiiSubjectKms(kms);
    const result = await runPiiEventBackfill(stack.db, stack.registry);
    expect(result.status).toBe("ran");
    if (result.status === "ran") expect(result.failures).toEqual([]);

    const events = await readEvents();
    expect(JSON.stringify(events)).not.toContain("Zebulon Quaxford");
    const byType = new Map(events.map((event) => [event.type, event.payload]));
    const createdBlob = byType.get("draft.created")?.["blob"];
    expect(isPiiCiphertext(createdBlob)).toBe(true);
    expect(await decryptBlob(createdBlob)).toEqual(BLOB);
    const updatedChanges = byType.get("draft.updated")?.["changes"] as Record<string, unknown>;
    expect(await decryptBlob(updatedChanges?.["blob"])).toEqual(updated);
    const previous = byType.get("draft.deleted")?.["previous"] as Record<string, unknown>;
    expect(await decryptBlob(previous?.["blob"])).toEqual(updated);
  });

  test("a second full pass (new transform version, state dropped) leaves already encrypted events untouched", async () => {
    await stack.http.writeOk("jbf:write:draft:create", { ownerId: OWNER_ID, blob: BLOB }, admin);
    configureBlindIndexKey(Buffer.alloc(32, 7).toString("base64"));
    configurePiiSubjectKms(kms);
    await runPiiEventBackfill(stack.db, stack.registry);
    const afterFirst = await readEvents();

    await asRawClient(stack.db).unsafe(`DROP TABLE "kumiko_pii_backfill_state"`);
    const second = await runPiiEventBackfill(stack.db, stack.registry);
    expect(second.status).toBe("ran");

    const afterSecond = await readEvents();
    expect(afterSecond).toEqual(afterFirst);
    expect(await decryptBlob(afterSecond[0]?.payload["blob"])).toEqual(BLOB);
  });

  test("legacy plaintext string and number scalars in a jsonb field are encrypted too", async () => {
    await stack.http.writeOk("jbf:write:seed-scalar", { blob: "Zebulon Quaxford" }, admin);
    await stack.http.writeOk("jbf:write:seed-scalar", { blob: 4711 }, admin);
    expect(JSON.stringify(await readEvents())).toContain("Zebulon Quaxford");

    configureBlindIndexKey(Buffer.alloc(32, 7).toString("base64"));
    configurePiiSubjectKms(kms);
    const result = await runPiiEventBackfill(stack.db, stack.registry);
    expect(result.status).toBe("ran");

    const events = await readEvents();
    expect(JSON.stringify(events)).not.toContain("Zebulon Quaxford");
    const decrypted = await Promise.all(events.map((event) => decryptBlob(event.payload["blob"])));
    expect(decrypted).toEqual(["Zebulon Quaxford", 4711]);
  });
});
