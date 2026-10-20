// tenant.name is encrypted under the tenant record (`record:tenant:<id>`), so
// the destroy pipeline's subject-keys stage must erase that key too — the
// existing `{ kind: "tenant" }` erase never reaches it. Driven through the real
// sweep/stages, not eraseKey directly, then read back raw from projection and
// event payload.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createTestEnvelopeCipher,
  resetPiiSubjectKmsForTests,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { decryptStoredPii } from "../../shared/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantTable } from "../../tenant/schema/tenant.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { createTenantLifecycleFeature } from "../feature.ts";
import { DESTRUCTION_STAGES } from "../stages.ts";
import { driveDestructionToCompletion, seedDestroyingTenant } from "../testing.ts";

const NAME = "Shred Me Holding";

let stack: TestStack;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
    ],
    extraContext: {
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
    },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [tenantTable, eventsTable]);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

async function createTenant(): Promise<TenantId> {
  const created = await stack.http.writeOk<{ id: string }>(
    TenantHandlers.create,
    { key: "shred-me", name: NAME },
    TestUsers.systemAdmin,
  );
  return created.id as TenantId;
}

async function storedNames(tenantId: TenantId): Promise<{
  readonly projection: unknown;
  readonly events: readonly unknown[];
}> {
  const rows = await selectMany<{ name: unknown }>(stack.db, tenantTable, { id: tenantId });
  const events = await selectMany<{ payload: Record<string, unknown> }>(stack.db, eventsTable, {
    aggregateId: tenantId,
  });
  return {
    projection: rows[0]?.name,
    events: events.map((e) => e.payload["name"]).filter((name) => name !== undefined),
  };
}

describe("tenant-lifecycle :: destroy shreds tenant.name", () => {
  test("after the sweep, projection and event name decrypt to the erased sentinel and the tombstone ran", async () => {
    const tenantId = await createTenant();
    const before = await storedNames(tenantId);
    expect(isPiiCiphertext(before.projection)).toBe(true);
    expect(await decryptStoredPii(String(before.projection), "name", "test")).toBe(NAME);

    await seedDestroyingTenant(stack.db, tenantId);
    const status = await driveDestructionToCompletion(stack, stack.db, tenantId);

    expect(status).toBe("destroyed");
    const after = await storedNames(tenantId);
    expect(isPiiCiphertext(after.projection)).toBe(true);
    expect(await decryptStoredPii(String(after.projection), "name", "test")).toBe(
      PII_ERASED_SENTINEL,
    );
    expect(after.events.length).toBeGreaterThan(0);
    for (const eventName of after.events) {
      expect(await decryptStoredPii(String(eventName), "name", "test")).toBe(PII_ERASED_SENTINEL);
    }
  });

  test("the tenant-row stage is idempotent: a second run on a destroyed tenant succeeds", async () => {
    const tenantId = await createTenant();
    await seedDestroyingTenant(stack.db, tenantId);
    expect(await driveDestructionToCompletion(stack, stack.db, tenantId)).toBe("destroyed");

    const tenantRow = DESTRUCTION_STAGES.find((stage) => stage.name === "tenant-row");
    if (!tenantRow) throw new Error("tenant-row stage missing");
    const outcome = await tenantRow.run({
      db: stack.db,
      registry: stack.registry,
      tenantId,
      deadlineAt: Number.POSITIVE_INFINITY,
    });

    expect(outcome.done).toBe(true);
    const [row] = await selectMany<{ status: string }>(stack.db, tenantTable, { id: tenantId });
    expect(row?.status).toBe("destroyed");
  });

  test("the derived search document of the tenant name is purged with the key", async () => {
    const tenantId = await createTenant();
    await stack.eventDispatcher?.runOnce();
    const [created] = await selectMany<{ tenantId: string }>(stack.db, eventsTable, {
      aggregateId: tenantId,
    });
    const docTenantId = (created?.tenantId ?? "") as TenantId;
    const findName = async () =>
      (await stack.search.search(docTenantId, "Shred", { filterType: "tenant" })).some(
        (hit) => String(hit.entityId) === tenantId,
      );
    expect(await findName()).toBe(true);

    await seedDestroyingTenant(stack.db, tenantId);
    const status = await driveDestructionToCompletion(stack, stack.db, tenantId, stack.search);

    expect(status).toBe("destroyed");
    expect(await findName()).toBe(false);
  });
});
