// Event-PII catalog (#799): defineEvent({ piiFields }) → createRegistry
// publishes the catalog → encryptEventPayloadPii encrypts under the owning
// user's DEK. append() applies this on every write path; the pure pieces
// are testable without a database.

import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { createRegistry, defineFeature } from "../../engine";
import {
  configuredEventPiiCatalog,
  configureEventPiiCatalog,
  encryptEventPayloadPii,
  resetEventPiiCatalogForTests,
} from "../event-pii";
import { InMemoryKmsAdapter } from "../in-memory-kms-adapter";
import {
  configurePiiSubjectKms,
  decryptPiiFieldValues,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
  resetPiiSubjectKmsForTests,
} from "../pii-field-encryption";

const attemptSchema = z.object({
  recipientId: z.string().nullable(),
  recipientAddress: z.string().nullable(),
  status: z.string(),
});

const EVENT_TYPE = "mailer:event:attempt";

function catalogWithAttempt(): void {
  configureEventPiiCatalog(
    new Map([[EVENT_TYPE, { recipientAddress: { subjectField: "recipientId" } }]]),
  );
}

afterEach(() => {
  resetEventPiiCatalogForTests();
  resetPiiSubjectKmsForTests();
});

describe("defineEvent piiFields validation", () => {
  test("valid piiFields land on the EventDef and in the registry catalog", () => {
    const feature = defineFeature("mailer", (r) => {
      r.defineEvent("attempt", attemptSchema, {
        piiFields: { recipientAddress: { subjectField: "recipientId" } },
      });
    });
    createRegistry([feature]);
    expect(configuredEventPiiCatalog().get(EVENT_TYPE)).toEqual({
      recipientAddress: { subjectField: "recipientId" },
    });
  });

  test("pii field not on the payload schema throws at definition time", () => {
    expect(() =>
      defineFeature("mailer", (r) => {
        r.defineEvent("attempt", attemptSchema, {
          piiFields: { nope: { subjectField: "recipientId" } },
        });
      }),
    ).toThrow(/piiFields references "nope"/);
  });

  test("unknown subjectField throws at definition time", () => {
    expect(() =>
      defineFeature("mailer", (r) => {
        r.defineEvent("attempt", attemptSchema, {
          piiFields: { recipientAddress: { subjectField: "ownerId" } },
        });
      }),
    ).toThrow(/piiFields references "ownerId"/);
  });

  test("field cannot be its own subjectField", () => {
    expect(() =>
      defineFeature("mailer", (r) => {
        r.defineEvent("attempt", attemptSchema, {
          piiFields: { recipientAddress: { subjectField: "recipientAddress" } },
        });
      }),
    ).toThrow(/cannot use itself as subjectField/);
  });

  test("events without piiFields do not enter the catalog", () => {
    const feature = defineFeature("mailer", (r) => {
      r.defineEvent("attempt", attemptSchema);
    });
    createRegistry([feature]);
    expect(configuredEventPiiCatalog().size).toBe(0);
  });
});

describe("encryptEventPayloadPii", () => {
  const payload = { recipientId: "u-1", recipientAddress: "u1@example.com", status: "sent" };

  test("uncatalogued event type returns the payload untouched (same reference)", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    expect(await encryptEventPayloadPii("other:event:x", payload)).toBe(payload);
  });

  test("no KMS configured → plaintext passthrough (rollout mode)", async () => {
    catalogWithAttempt();
    expect(await encryptEventPayloadPii(EVENT_TYPE, payload)).toBe(payload);
  });

  test("encrypts under the subject's DEK; subject fk stays plaintext", async () => {
    catalogWithAttempt();
    const kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);

    const out = await encryptEventPayloadPii(EVENT_TYPE, payload);
    expect(isPiiCiphertext(out["recipientAddress"])).toBe(true);
    expect(String(out["recipientAddress"])).toContain("user:u-1");
    expect(out["recipientId"]).toBe("u-1");
    expect(out["status"]).toBe("sent");

    const back = await decryptPiiFieldValues(out, ["recipientAddress"], kms, {
      requestId: "test",
    });
    expect(back["recipientAddress"]).toBe("u1@example.com");
  });

  test("null subject field → value stays plaintext (no user key to shred)", async () => {
    catalogWithAttempt();
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const systemPayload = {
      recipientId: null,
      recipientAddress: "ops@example.com",
      status: "sent",
    };
    expect(await encryptEventPayloadPii(EVENT_TYPE, systemPayload)).toBe(systemPayload);
  });

  test("null pii value passes through", async () => {
    catalogWithAttempt();
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const skipped = { recipientId: "u-1", recipientAddress: null, status: "skipped" };
    expect(await encryptEventPayloadPii(EVENT_TYPE, skipped)).toBe(skipped);
  });

  test("idempotent: ciphertext and erased sentinel stay as-is", async () => {
    catalogWithAttempt();
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const once = await encryptEventPayloadPii(EVENT_TYPE, payload);
    const twice = await encryptEventPayloadPii(EVENT_TYPE, once);
    expect(twice["recipientAddress"]).toBe(once["recipientAddress"]);

    const erased = { ...payload, recipientAddress: PII_ERASED_SENTINEL };
    const out = await encryptEventPayloadPii(EVENT_TYPE, erased);
    expect(out["recipientAddress"]).toBe(PII_ERASED_SENTINEL);
  });

  test("non-string pii value is a loud error, not a silent skip", async () => {
    catalogWithAttempt();
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const broken = { recipientId: "u-1", recipientAddress: 42, status: "sent" };
    expect(encryptEventPayloadPii(EVENT_TYPE, broken)).rejects.toThrow(/must be a string/);
  });
});
