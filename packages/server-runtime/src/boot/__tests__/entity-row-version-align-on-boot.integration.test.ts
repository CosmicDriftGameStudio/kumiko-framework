// Rows that received domain events before domain events moved `row.version` live keep the version of
// their last lifecycle event. The prod shape is built with the event-store `append`, which bypasses
// the projection pipeline exactly like the old live path did.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  alignLiveRowVersionsWithStreams,
  buildEntityTable,
  createEventStoreExecutor,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { append } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import {
  alignEntityRowVersionsOnBoot,
  startEntityRowRepairsOnBoot,
} from "../entity-row-version-align-on-boot.ts";

const parcelEntity = createEntity({
  name: "aligned-parcel",
  table: "read_aligned_parcels",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const parcelTable = buildEntityTable(parcelEntity);
const parcelExecutor = createEventStoreExecutor(parcelTable, parcelEntity, {
  entityName: "aligned-parcel",
});

const PARCEL_SCANNED_EVENT = "parcels:event:scanned";

const parcelFeature = defineFeature("parcels", (r) => {
  r.entity(parcelEntity);
  r.defineEvent("scanned", z.object({ hub: z.string() }), { piiFields: "none" });
  r.writeHandler({
    name: "parcel:create",
    schema: z.object({ label: z.string() }),
    handler: async (event, ctx) => parcelExecutor.create(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });
  r.writeHandler({
    name: "parcel:update",
    schema: z.object({
      id: z.uuid(),
      version: z.number(),
      changes: z.record(z.string(), z.unknown()),
    }),
    handler: async (event, ctx) => parcelExecutor.update(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });
  r.queryHandler({
    name: "parcel:detail",
    schema: z.object({ id: z.uuid() }),
    handler: async (query, ctx) => parcelExecutor.detail(query.payload, query.user, ctx.db),
    access: { roles: ["Admin"] },
  });
});

const admin = TestUsers.admin;
let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [parcelFeature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, parcelEntity, "aligned-parcel");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, ["read_aligned_parcels"]);
});

async function storedVersion(id: string): Promise<number | undefined> {
  return (await selectMany<{ version: number }>(stack.db, parcelTable, { id }))[0]?.version;
}

async function detailVersion(id: string): Promise<unknown> {
  const detail = await stack.http.queryOk<Record<string, unknown>>(
    "parcels:query:parcel:detail",
    { id },
    admin,
  );
  return detail["version"];
}

// The row of a stream with one lifecycle event and two domain events written by the old live path.
async function createParcelWithLegacyDomainEvents(): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "parcels:write:parcel:create",
    { label: "Parcel A" },
    admin,
  );
  for (const [expectedVersion, hub] of [
    [1, "Leipzig"],
    [2, "Hamburg"],
  ] as const) {
    await append(stack.db, {
      aggregateId: created.id,
      aggregateType: "aligned-parcel",
      tenantId: admin.tenantId,
      expectedVersion,
      type: PARCEL_SCANNED_EVENT,
      payload: { hub },
      metadata: { userId: admin.id },
    });
  }
  return created.id;
}

describe("entity row version alignment on boot", () => {
  test("a row behind its stream takes the stream version and can be edited with the detail version", async () => {
    const id = await createParcelWithLegacyDomainEvents();
    expect(await storedVersion(id)).toBe(1);
    const stale = await stack.http.write(
      "parcels:write:parcel:update",
      { id, version: await detailVersion(id), changes: { label: "Parcel B" } },
      admin,
    );
    expect(stale.status).toBe(409);

    const result = await alignEntityRowVersionsOnBoot(stack.db, stack.registry);

    expect(result).toEqual({
      alignedRows: 1,
      failedTables: [],
      lockTimeoutTables: [],
      aborted: false,
    });
    expect(await storedVersion(id)).toBe(3);
    const updated = await stack.http.writeOk<{ data: { version: number } }>(
      "parcels:write:parcel:update",
      { id, version: await detailVersion(id), changes: { label: "Parcel B" } },
      admin,
    );
    expect(updated.data.version).toBe(4);
  });

  test("a second run changes nothing", async () => {
    const id = await createParcelWithLegacyDomainEvents();
    await alignEntityRowVersionsOnBoot(stack.db, stack.registry);

    const second = await alignEntityRowVersionsOnBoot(stack.db, stack.registry);

    expect(second).toEqual({
      alignedRows: 0,
      failedTables: [],
      lockTimeoutTables: [],
      aborted: false,
    });
    expect(await storedVersion(id)).toBe(3);
  });

  test("a table larger than one batch is aligned across all batches", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await createParcelWithLegacyDomainEvents());

    const result = await alignEntityRowVersionsOnBoot(stack.db, stack.registry, { batchSize: 2 });

    expect(result.alignedRows).toBe(5);
    for (const id of ids) expect(await storedVersion(id)).toBe(3);
  });

  test("an aborted run stops before the table and the next run aligns the rows", async () => {
    const id = await createParcelWithLegacyDomainEvents();
    const shutdown = new AbortController();
    shutdown.abort();

    const aborted = await alignEntityRowVersionsOnBoot(stack.db, stack.registry, {
      signal: shutdown.signal,
    });

    expect(aborted).toMatchObject({ alignedRows: 0, aborted: true });
    expect(
      await alignLiveRowVersionsWithStreams(
        stack.db,
        "read_aligned_parcels",
        ["aligned-parcel"],
        false,
        { signal: shutdown.signal, batchSize: 1 },
      ),
    ).toEqual({ alignedRows: 0, stoppedBy: "aborted" });
    expect(await storedVersion(id)).toBe(1);
    const next = await alignEntityRowVersionsOnBoot(stack.db, stack.registry);
    expect(next.alignedRows).toBe(1);
    expect(await storedVersion(id)).toBe(3);
  });

  test("another tenant's stream with the same aggregate id leaves the row alone", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      "parcels:write:parcel:create",
      { label: "Parcel T" },
      admin,
    );
    for (const expectedVersion of [0, 1, 2]) {
      await append(stack.db, {
        aggregateId: created.id,
        aggregateType: "aligned-parcel",
        tenantId: TestUsers.otherTenant.tenantId,
        expectedVersion,
        type: PARCEL_SCANNED_EVENT,
        payload: { hub: "Wien" },
        metadata: { userId: admin.id },
      });
    }

    const result = await alignEntityRowVersionsOnBoot(stack.db, stack.registry);

    expect(result.alignedRows).toBe(0);
    expect(await storedVersion(created.id)).toBe(1);
  });
});

describe("follow-up run after the boot run", () => {
  function startRepairs() {
    const hooks: Array<() => Promise<void>> = [];
    const handle = startEntityRowRepairsOnBoot({
      db: stack.db,
      registry: stack.registry,
      lifecycle: { registerShutdownHook: (_name, fn) => void hooks.push(fn) },
      followUpDelayMs: 500,
    });
    const shutdown = async () => {
      for (const hook of hooks) await hook();
    };
    return { handle, shutdown };
  }

  test("repairs a row a previous-release pod wrote after the boot run", async () => {
    const { handle, shutdown } = startRepairs();
    await handle.firstRun;
    const id = await createParcelWithLegacyDomainEvents();
    expect(await storedVersion(id)).toBe(1);

    expect(await handle.settled).toEqual({ followUpRan: true });

    expect(await storedVersion(id)).toBe(3);
    await shutdown();
  });

  test("a shutdown before the delay ran out cancels the follow-up", async () => {
    const { handle, shutdown } = startRepairs();
    await handle.firstRun;
    const id = await createParcelWithLegacyDomainEvents();

    await shutdown();

    expect(await handle.settled).toEqual({ followUpRan: false });
    expect(await storedVersion(id)).toBe(1);
  });
});
