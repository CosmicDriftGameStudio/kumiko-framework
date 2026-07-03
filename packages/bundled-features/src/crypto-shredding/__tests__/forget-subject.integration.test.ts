// crypto-shredding forget-subject — end-to-end over real HTTP dispatch:
//
//   - DPO erases a user subject → DEK gone (getKey throws KeyErased),
//     subject-forgotten audit event appended
//   - tenant subjects shred the same way
//   - repeat forget is a no-op erase but still audited
//   - no KMS configured → 500 with actionable message
//   - Member role → 403 (DPO/SystemAdmin only)

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { setupTestStack, type TestStack, testTenantId } from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { SUBJECT_FORGOTTEN_EVENT_NAME } from "../constants";
import { createCryptoShreddingFeature } from "../feature";

const FORGET = "crypto-shredding:write:forget-subject";

let stack: TestStack;
let kms: InMemoryKmsAdapter;

const TENANT: TenantId = testTenantId(1);
const TARGET_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const TARGET_TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-0000000000a1";
const REASON = "authority request #42 (Art. 17)";

const dpoUser = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-0000000000d1",
  tenantId: TENANT,
  roles: ["DataProtectionOfficer"],
};

const memberUser = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-0000000000e1",
  tenantId: TENANT,
  roles: ["Member"],
};

beforeAll(async () => {
  stack = await setupTestStack({ features: [createCryptoShreddingFeature()] });
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [eventsTable]);
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

async function forgottenEvents(): Promise<Array<{ payload: Record<string, unknown> }>> {
  return (await selectMany(stack.db, eventsTable, {
    type: SUBJECT_FORGOTTEN_EVENT_NAME,
  })) as Array<{ payload: Record<string, unknown> }>;
}

describe("crypto-shredding :: forget-subject", () => {
  test("DPO forgets a user subject → key erased + audit event", async () => {
    const subject = { kind: "user", userId: TARGET_USER_ID } as const;
    await kms.createKey(subject);

    const result = await stack.http.writeOk<{ subjectKey: string }>(
      FORGET,
      { subject, reason: REASON },
      dpoUser,
    );
    expect(result.subjectKey).toBe(`user:${TARGET_USER_ID}`);

    await expect(kms.getKey(subject)).rejects.toThrow("Subject key erased");

    const events = await forgottenEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      subjectKey: `user:${TARGET_USER_ID}`,
      reason: REASON,
      forgottenBy: dpoUser.id,
    });
  });

  test("tenant subject shreds the same way", async () => {
    const subject = { kind: "tenant", tenantId: TARGET_TENANT_ID } as const;
    await kms.createKey({ kind: "tenant", tenantId: TARGET_TENANT_ID as TenantId });

    const result = await stack.http.writeOk<{ subjectKey: string }>(
      FORGET,
      { subject, reason: REASON },
      dpoUser,
    );
    expect(result.subjectKey).toBe(`tenant:${TARGET_TENANT_ID}`);

    await expect(
      kms.getKey({ kind: "tenant", tenantId: TARGET_TENANT_ID as TenantId }),
    ).rejects.toThrow("Subject key erased");
  });

  test("repeat forget: erase is a no-op but each attempt is audited", async () => {
    const subject = { kind: "user", userId: TARGET_USER_ID } as const;
    await kms.createKey(subject);

    await stack.http.writeOk(FORGET, { subject, reason: REASON }, dpoUser);
    await stack.http.writeOk(FORGET, { subject, reason: `${REASON} (repeat)` }, dpoUser);

    expect(await forgottenEvents()).toHaveLength(2);
  });

  test("no KMS configured → 500 with boot hint", async () => {
    resetPiiSubjectKmsForTests();

    const err = await stack.http.writeErr(
      FORGET,
      { subject: { kind: "user", userId: TARGET_USER_ID }, reason: REASON },
      dpoUser,
    );
    expect(err.httpStatus).toBe(500);
  });

  test("Member role → 403", async () => {
    const err = await stack.http.writeErr(
      FORGET,
      { subject: { kind: "user", userId: TARGET_USER_ID }, reason: REASON },
      memberUser,
    );
    expect(err.httpStatus).toBe(403);
  });

  test("reason shorter than 10 chars → schema reject", async () => {
    const err = await stack.http.writeErr(
      FORGET,
      { subject: { kind: "user", userId: TARGET_USER_ID }, reason: "short" },
      dpoUser,
    );
    expect(err.httpStatus).toBe(400);
  });
});
