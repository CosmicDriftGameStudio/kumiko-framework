import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { runRetentionCleanup } from "../../data-retention/index.ts";
import { waitlistEntryEntity, waitlistEntryTable } from "../entity.ts";
import { WaitlistHandlers } from "../web/constants.ts";
import {
  createWaitlistTestStack,
  resetWaitlistTestState,
  SYSTEM_ADMIN,
} from "./waitlist-test-stack.ts";

const KEEP_FOR_DAYS = 30;

async function submitEntry(stack: TestStack, email: string): Promise<void> {
  const res = await stack.http.raw(
    "POST",
    "/api/write",
    { type: WaitlistHandlers.submit, payload: { name: "Ada Lovelace", email, locale: "en" } },
    { "x-forwarded-for": "198.51.100.9" },
  );
  expect(res.status).toBe(200);
}

function sweepAt(stack: TestStack, daysFromNow: number) {
  return runRetentionCleanup({
    db: stack.db,
    registry: stack.registry,
    tenantId: SYSTEM_TENANT_ID,
    preloadedTenantPreset: null,
    now: Temporal.Now.instant().add({ hours: daysFromNow * 24 }),
  });
}

describe("waitlist retention option", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await createWaitlistTestStack({
      rateLimit: { disabled: true, reason: "test" },
      retention: { keepFor: `${KEEP_FOR_DAYS}d` },
    });
  });
  afterAll(async () => {
    await stack.cleanup();
  });
  beforeEach(async () => {
    await resetWaitlistTestState(stack);
  });

  test("entries within keepFor stay", async () => {
    await submitEntry(stack, "fresh@example.com");

    await sweepAt(stack, KEEP_FOR_DAYS - 1);

    expect(await selectMany(stack.db, waitlistEntryTable, {})).toHaveLength(1);
  });

  test("entries past keepFor are deleted whatever their status", async () => {
    await submitEntry(stack, "pending@example.com");
    await submitEntry(stack, "rejected@example.com");
    const rows = await selectMany(stack.db, waitlistEntryTable, {});
    expect(rows).toHaveLength(2);
    await stack.http.writeOk(
      WaitlistHandlers.reject,
      { id: String(rows[0]?.["id"]) },
      SYSTEM_ADMIN,
    );

    const result = await sweepAt(stack, KEEP_FOR_DAYS + 1);

    expect(result.hardDeleted).toBe(2);
    expect(await selectMany(stack.db, waitlistEntryTable, {})).toHaveLength(0);
  });
});

describe("waitlist without the retention option", () => {
  test("the entry entity declares no retention", () => {
    expect(waitlistEntryEntity.retention).toBeUndefined();
  });
});
