import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { asRawClient } from "../../db/query.ts";
import { append } from "../../event-store/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { scrubEventHeaderKeys } from "../event-header-scrub.ts";

const REASON = "provider payload with customer details was stored in event headers";

describe("scrubEventHeaderKeys", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [] });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  async function appendWithHeaders(type: string, headers: Record<string, string>): Promise<string> {
    const aggregateId = crypto.randomUUID();
    await append(stack.db, {
      aggregateId,
      aggregateType: "probe",
      tenantId: TestUsers.user.tenantId,
      expectedVersion: 0,
      type,
      payload: { status: "active" },
      metadata: { userId: TestUsers.user.id, headers },
    });
    return aggregateId;
  }

  async function headersOf(aggregateId: string): Promise<Record<string, unknown>> {
    const rows = await asRawClient(stack.db).unsafe<{ headers: Record<string, unknown> }>(
      `SELECT "metadata"->'headers' AS headers FROM "kumiko_events" WHERE "aggregate_id" = $1`,
      [aggregateId],
    );
    return rows[0]?.headers ?? {};
  }

  test("removes the key from the matching event types only and keeps the other headers", async () => {
    const hit = await appendWithHeaders("probe.header-scrub-hit", {
      providerEventId: "evt_1",
      rawPayload: '{"email":"ada@example.com"}',
    });
    const otherType = await appendWithHeaders("probe.header-scrub-other", {
      rawPayload: "kept",
    });

    const dry = await scrubEventHeaderKeys(stack.db, {
      eventTypes: ["probe.header-scrub-hit"],
      keys: ["rawPayload"],
      reason: REASON,
      dryRun: true,
    });
    expect(dry.removedKeys).toBe(1);
    expect(await headersOf(hit)).toHaveProperty("rawPayload");

    const result = await scrubEventHeaderKeys(stack.db, {
      eventTypes: ["probe.header-scrub-hit"],
      keys: ["rawPayload"],
      reason: REASON,
    });

    expect(result.removedKeys).toBe(1);
    expect(await headersOf(hit)).toEqual({ providerEventId: "evt_1" });
    expect(await headersOf(otherType)).toEqual({ rawPayload: "kept" });
  });

  test("refuses a placeholder reason", () => {
    expect(() =>
      scrubEventHeaderKeys(stack.db, {
        eventTypes: ["probe.header-scrub-hit"],
        keys: ["rawPayload"],
        reason: "todo",
      }),
    ).toThrow();
  });
});
