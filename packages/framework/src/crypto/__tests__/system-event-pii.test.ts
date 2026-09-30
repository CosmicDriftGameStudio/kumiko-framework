// System events bypass the defineEvent catalog, so their PII stance lives in
// a static map. An undeclared system type must fail closed (also without a
// KMS), and every known system type must have a declared stance.

import { afterEach, describe, expect, test } from "bun:test";
import * as stepDispatchConstants from "../../engine/steps/_step-dispatch-constants";
import type { TenantId } from "../../engine/types/identifiers";
import { encryptEventPayloadPii } from "../event-pii";
import { InMemoryKmsAdapter } from "../in-memory-kms-adapter";
import {
  configurePiiSubjectKms,
  isPiiCiphertext,
  resetPiiSubjectKmsForTests,
} from "../pii-field-encryption";
import type { EventSubjectEnvelope } from "../subject-resolver";
import {
  AGGREGATE_TRANSFERRED_EVENT_TYPE,
  SYSTEM_EVENT_PII_STANCES,
  SYSTEM_EVENT_PREFIX,
} from "../system-event-pii";

const ENVELOPE: EventSubjectEnvelope = {
  tenantId: "6b2f4a0e-1c9d-4f3a-9d2e-0000000000e1" as TenantId,
  aggregateType: "step-dispatch",
  aggregateId: "6b2f4a0e-1c9d-4f3a-9d2e-0000000000e2",
};

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

describe("system event PII stances", () => {
  test("every system event type constant has a declared stance", () => {
    const declaredTypes = [
      ...Object.entries(stepDispatchConstants)
        .filter(([name]) => name.endsWith("_TYPE"))
        .map(([, value]: [string, unknown]) => value)
        .filter(
          (value): value is string =>
            typeof value === "string" && value.startsWith(SYSTEM_EVENT_PREFIX),
        ),
      AGGREGATE_TRANSFERRED_EVENT_TYPE,
    ];
    expect(declaredTypes.length).toBeGreaterThanOrEqual(11);
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
    const payload = { stepKind: "mail.send", status: 202 };
    expect(
      await encryptEventPayloadPii(stepDispatchConstants.STEP_DISPATCHED_TYPE, payload, ENVELOPE),
    ).toBe(payload);
  });

  test("dispatch-requested encrypts its string fields under the per-dispatch record key", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const out = await encryptEventPayloadPii(
      stepDispatchConstants.STEP_DISPATCH_REQUESTED_TYPE,
      { stepKind: "mail.send", to: '"a@example.com"', subject: "Hi", body: "Body" },
      ENVELOPE,
    );
    expect(out["stepKind"]).toBe("mail.send");
    for (const field of ["to", "subject", "body"]) {
      expect(isPiiCiphertext(out[field])).toBe(true);
      expect(String(out[field])).toContain(`record:step-dispatch:${ENVELOPE.aggregateId}`);
    }
  });
});
