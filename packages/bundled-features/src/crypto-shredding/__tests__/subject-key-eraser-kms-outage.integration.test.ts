// A KMS outage while the subject-key-eraser consumer erases a forgotten subject's key must keep
// the key, park the consumer as dead after the retries, and erase the key once an operator
// restarts the consumer with a healthy KMS.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  KeyErasedError,
} from "@cosmicdrift/kumiko-framework/crypto";
import { getConsumerState, restartConsumer } from "@cosmicdrift/kumiko-framework/pipeline";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { resetEventStore, setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { SUBJECT_KEY_ERASER_CONSUMER_NAME } from "../constants.ts";
import { createCryptoShreddingFeature } from "../feature.ts";

const FORGET = "crypto-shredding:write:forget-subject";
const REASON = "authority request #4120 (KMS outage during key erase)";
const SUBJECT_USER_ID = "dddddddd-dddd-4ddd-8ddd-000000000041";
const KMS_UNAVAILABLE = "kms unavailable";
// Default maxAttempts of the event dispatcher.
const DISPATCHER_MAX_ATTEMPTS = 10;

const dpoUser = {
  id: "cccccccc-cccc-4ccc-8ccc-000000000041",
  tenantId: testTenantId(41),
  roles: ["DataProtectionOfficer"],
};

class OutageKmsAdapter extends InMemoryKmsAdapter {
  unavailable = false;

  override async eraseKey(...args: Parameters<InMemoryKmsAdapter["eraseKey"]>): Promise<void> {
    if (this.unavailable) throw new Error(KMS_UNAVAILABLE);
    await super.eraseKey(...args);
  }
}

let stack: TestStack;
let kms: OutageKmsAdapter;
const subject = { kind: "user" as const, userId: SUBJECT_USER_ID };

beforeAll(async () => {
  stack = await setupTestStack({ features: [createCryptoShreddingFeature()] });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetEventStore(stack, []);
  kms = new OutageKmsAdapter();
  configurePiiSubjectKms(kms);
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

describe("crypto-shredding :: subject-key-eraser during a KMS outage", () => {
  test("keeps the key, parks the consumer as dead, and erases the key after a restart", async () => {
    await kms.createKey(subject);
    kms.unavailable = true;

    await stack.http.writeOk(FORGET, { subject, reason: REASON }, dpoUser);
    for (let pass = 0; pass < DISPATCHER_MAX_ATTEMPTS; pass++) {
      await stack.eventDispatcher?.runOnce();
    }

    const parked = await getConsumerState(stack.db, SUBJECT_KEY_ERASER_CONSUMER_NAME);
    expect(parked?.status).toBe("dead");
    // The configured KMS wraps adapter failures, so the consumer state carries the outage class, not the adapter text.
    expect(parked?.lastError).toContain("the PII key store is unavailable");
    await expect(kms.getKey(subject)).resolves.toBeDefined();

    kms.unavailable = false;
    await restartConsumer(stack.db, SUBJECT_KEY_ERASER_CONSUMER_NAME);
    await stack.eventDispatcher?.runOnce();

    await expect(kms.getKey(subject)).rejects.toBeInstanceOf(KeyErasedError);
    const recovered = await getConsumerState(stack.db, SUBJECT_KEY_ERASER_CONSUMER_NAME);
    expect(recovered?.status).toBe("idle");
  });
});
