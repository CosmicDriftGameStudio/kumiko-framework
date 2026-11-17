// System events bypass the defineEvent catalog, so their PII stance lives in
// a static map. An undeclared system type must fail closed (also without a
// KMS), and every known system type must have a declared stance.

import { afterEach, describe, expect, test } from "bun:test";
import type { TenantId } from "../../engine/types/identifiers.ts";
import { encryptEventPayloadPii } from "../event-pii.ts";
import { InMemoryKmsAdapter } from "../in-memory-kms-adapter.ts";
import {
  configurePiiSubjectKms,
  resetPiiSubjectKmsForTests,
} from "../pii-field-encryption.ts";
import type { EventSubjectEnvelope } from "../subject-resolver.ts";
import {
  AGGREGATE_TRANSFERRED_EVENT_TYPE,
  APP_STARTED_EVENT_TYPE,
  SYSTEM_EVENT_PII_STANCES,
  SYSTEM_EVENT_PREFIX,
} from "../system-event-pii.ts";

const ENVELOPE: EventSubjectEnvelope = {
  tenantId: "6b2f4a0e-1c9d-4f3a-9d2e-0000000000e1" as TenantId,
  aggregateType: "app-instance",
  aggregateId: "6b2f4a0e-1c9d-4f3a-9d2e-0000000000e2",
};

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

describe("system event PII stances", () => {
  test("every system event type constant has a declared stance", () => {
    const declaredTypes = [
      AGGREGATE_TRANSFERRED_EVENT_TYPE,
      APP_STARTED_EVENT_TYPE,
    ];
    for (const type of declaredTypes) {
      expect(SYSTEM_EVENT_PII_STANCES.has(type)).toBe(true);
    }
  });

  test("an undeclared system type fails closed, even without a configured KMS", async () => {
    await expect(
      encryptEventPayloadPii(`${SYSTEM_EVENT_PREFIX}made.up`, { secret: "x" }, ENVELOPE),
    ).rejects.toThrow(/System event "kumiko:system:made\.up" has no PII stance/);
  });

  test('a "none" stance passes the payload through untouched', async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const payload = { version: "1.0.0", pod: "app-0" };
    expect(
      await encryptEventPayloadPii(APP_STARTED_EVENT_TYPE, payload, ENVELOPE),
    ).toBe(payload);
  });
});
