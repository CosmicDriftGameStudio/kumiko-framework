// The shutdown hook of startPiiEventBackfillOnBoot must abort the running
// backfill and wait for it. Real events in a real database: an aborted run
// leaves the stored payloads untouched, a run that is not aborted rewrites them.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEntity,
  createTextField,
  defineEntityQueryHandler,
  defineEntityWriteHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { runPiiEventBackfill } from "@cosmicdrift/kumiko-framework/migrations";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/testing";
import { startPiiEventBackfillOnBoot } from "../pii-event-backfill-on-boot";

const TABLE = "read_backfill_boot_contacts";
const BIDX_KEY = Buffer.alloc(32, 7).toString("base64");

const contactEntity = createEntity({
  table: TABLE,
  fields: { email: createTextField({ required: true, personal: "self", find: "exact" }) },
});
const crmFeature = defineFeature("crm", (r) => {
  r.entity("contact", contactEntity);
  r.writeHandler(
    defineEntityWriteHandler("contact:create", contactEntity, { access: { roles: ["Admin"] } }),
  );
  r.queryHandler(
    defineEntityQueryHandler("contact:detail", contactEntity, { access: { roles: ["Admin"] } }),
  );
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [crmFeature] });
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

async function storedEmailsAreCiphertext(): Promise<readonly boolean[]> {
  const rows = (await asRawClient(stack.db).unsafe(
    `SELECT "payload" FROM "kumiko_events" ORDER BY "id"`,
  )) as ReadonlyArray<{ payload: Record<string, unknown> }>;
  return rows.map((row) => isPiiCiphertext(row.payload["email"]));
}

async function writePlaintextContacts(count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    await stack.http.writeOk(
      "crm:write:contact:create",
      { email: `boot-backfill-${index}@example.com` },
      TestUsers.admin,
    );
  }
}

function armKms(): void {
  configureBlindIndexKey(BIDX_KEY);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
}

describe("startPiiEventBackfillOnBoot shutdown hook", () => {
  test("aborts the running backfill and awaits it: stored events stay untouched", async () => {
    await writePlaintextContacts(3);
    expect(await storedEmailsAreCiphertext()).toEqual([false, false, false]);
    armKms();
    const hooks: Array<() => Promise<void>> = [];

    startPiiEventBackfillOnBoot({
      db: stack.db,
      registry: stack.registry,
      lifecycle: { registerShutdownHook: (_name, fn) => void hooks.push(fn) },
      envSource: {},
    });
    expect(hooks).toHaveLength(1);
    await hooks[0]?.();

    expect(await storedEmailsAreCiphertext()).toEqual([false, false, false]);
  });

  test("control: the same data is rewritten when the run is not aborted", async () => {
    await writePlaintextContacts(3);
    armKms();

    await runPiiEventBackfill(stack.db, stack.registry);

    expect(await storedEmailsAreCiphertext()).toEqual([true, true, true]);
  });
});
