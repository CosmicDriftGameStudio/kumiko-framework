import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configurePiiSubjectKms,
  ENCRYPTION_UNAVAILABLE_CODE,
  InMemoryKmsAdapter,
  type SubjectId,
} from "@cosmicdrift/kumiko-framework/crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { waitlistEntryTable } from "../entity.ts";
import { WAITLIST_PURGED_EVENT_QN, WaitlistHandlers } from "../web/constants.ts";
import {
  createWaitlistTestStack,
  resetWaitlistTestState,
  SYSTEM_ADMIN,
} from "./waitlist-test-stack.ts";

// The KMS is not a transaction participant: a shred that already ran cannot be rolled back.
class FlakyEraseKmsAdapter extends InMemoryKmsAdapter {
  erased = 0;
  failOnErase: number | undefined;

  override async eraseKey(subject: SubjectId): Promise<void> {
    if (this.failOnErase === this.erased + 1) throw new Error("kms unavailable");
    await super.eraseKey(subject);
    this.erased += 1;
  }
}

async function submitEntry(stack: TestStack, email: string): Promise<void> {
  const res = await stack.http.raw(
    "POST",
    "/api/write",
    {
      type: WaitlistHandlers.submit,
      payload: { name: "Ada Lovelace", email, locale: "en", message: "private note" },
    },
    { "x-forwarded-for": "198.51.100.9" },
  );
  expect(res.status).toBe(200);
}

async function purgeAudits(stack: TestStack): Promise<number> {
  const rows = await selectMany(stack.db, eventsTable, { type: WAITLIST_PURGED_EVENT_QN });
  return rows.length;
}

describe("waitlist purge when a key shred fails midway", () => {
  let stack: TestStack;
  let kms: FlakyEraseKmsAdapter;

  beforeAll(async () => {
    stack = await createWaitlistTestStack({ rateLimit: { disabled: true, reason: "test" } });
  });
  afterAll(async () => {
    await stack.cleanup();
  });
  beforeEach(async () => {
    await resetWaitlistTestState(stack);
    kms = new FlakyEraseKmsAdapter();
    configurePiiSubjectKms(kms);
  });
  afterAll(() => {
    resetPiiSubjectKmsForTests();
  });

  test("the failed purge leaves the entries in place and a retry finishes it with its audit event", async () => {
    for (const email of ["a@example.com", "b@example.com", "c@example.com"]) {
      await submitEntry(stack, email);
    }
    const auditsBefore = await purgeAudits(stack);

    kms.failOnErase = 2;
    const failure = await stack.http.writeErr(
      WaitlistHandlers.purge,
      { confirmCount: 3 },
      SYSTEM_ADMIN,
    );
    expect(failure.httpStatus).toBe(503);
    expect(failure.code).toBe(ENCRYPTION_UNAVAILABLE_CODE);
    expect(kms.erased).toBe(1);
    expect(await selectMany(stack.db, waitlistEntryTable, {})).toHaveLength(3);
    expect(await purgeAudits(stack)).toBe(auditsBefore);

    kms.failOnErase = undefined;
    const purged = await stack.http.writeOk<{ purged: number }>(
      WaitlistHandlers.purge,
      { confirmCount: 3 },
      SYSTEM_ADMIN,
    );
    expect(purged.purged).toBe(3);
    expect(await selectMany(stack.db, waitlistEntryTable, {})).toHaveLength(0);
    expect(await purgeAudits(stack)).toBe(auditsBefore + 1);
  });
});
