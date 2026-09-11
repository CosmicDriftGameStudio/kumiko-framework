// Event-PII catalog (#799): defineEvent({ piiFields }) → createRegistry
// publishes the catalog → encryptEventPayloadPii encrypts under the owning
// user's DEK. append() applies this on every write path; the pure pieces
// are testable without a database.

import { afterEach, describe, expect, test } from "bun:test";
import { normalizeEventPiiSubject } from "@cosmicdrift/kumiko-types/handlers";
import { z } from "zod";
import { createRegistry, defineFeature } from "../../engine";
import type { TenantId } from "../../engine/types/identifiers";
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
import type { EventSubjectEnvelope } from "../subject-resolver";

const attemptSchema = z.object({
  recipientId: z.string().nullable(),
  recipientAddress: z.string().nullable(),
  status: z.string(),
});

const EVENT_TYPE = "mailer:event:attempt";

const ENVELOPE: EventSubjectEnvelope = {
  tenantId: "6b2f4a0e-1c9d-4f3a-9d2e-0000000000e1" as TenantId,
  aggregateType: "mailer-attempt",
  aggregateId: "6b2f4a0e-1c9d-4f3a-9d2e-0000000000e2",
};

function catalogWithAttempt(): void {
  configureEventPiiCatalog(
    new Map([[EVENT_TYPE, { recipientAddress: { subjectField: "recipientId" } }]]),
  );
}

afterEach(() => {
  resetEventPiiCatalogForTests();
  resetPiiSubjectKmsForTests();
});

describe("normalizeEventPiiSubject", () => {
  test("canonical personal.of and legacy subjectField normalize to the same form", () => {
    expect(normalizeEventPiiSubject({ personal: { of: "recipientId" } })).toEqual({
      kind: "user",
      ownerField: "recipientId",
    });
    expect(normalizeEventPiiSubject({ subjectField: "recipientId" })).toEqual({
      kind: "user",
      ownerField: "recipientId",
    });
  });
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

  test("field cannot be its own subjectField (legacy form)", () => {
    expect(() =>
      defineFeature("mailer", (r) => {
        r.defineEvent("attempt", attemptSchema, {
          piiFields: { recipientAddress: { subjectField: "recipientAddress" } },
        });
      }),
    ).toThrow(/cannot use itself as the owner field/);
  });

  test("valid canonical personal.of piiFields land on the EventDef and in the registry catalog", () => {
    const feature = defineFeature("mailer", (r) => {
      r.defineEvent("attempt", attemptSchema, {
        piiFields: { recipientAddress: { personal: { of: "recipientId" } } },
      });
    });
    createRegistry([feature]);
    expect(configuredEventPiiCatalog().get(EVENT_TYPE)).toEqual({
      recipientAddress: { personal: { of: "recipientId" } },
    });
  });

  test("unknown owner field throws at definition time (canonical form)", () => {
    expect(() =>
      defineFeature("mailer", (r) => {
        r.defineEvent("attempt", attemptSchema, {
          piiFields: { recipientAddress: { personal: { of: "ownerId" } } },
        });
      }),
    ).toThrow(/piiFields references "ownerId"/);
  });

  test("field cannot be its own owner field (canonical form)", () => {
    expect(() =>
      defineFeature("mailer", (r) => {
        r.defineEvent("attempt", attemptSchema, {
          piiFields: { recipientAddress: { personal: { of: "recipientAddress" } } },
        });
      }),
    ).toThrow(/cannot use itself as the owner field/);
  });

  test("omitting the options argument throws an explicit PII stance error (fw#2558)", () => {
    expect(() =>
      defineFeature("mailer", (r) => {
        // @cast-boundary test-only — the type signature makes `options`
        // mandatory, but an untyped JS consumer can still omit it at
        // runtime; the registrar must fail closed for that caller too.
        (r.defineEvent as (name: string, schema: typeof attemptSchema) => unknown)(
          "attempt",
          attemptSchema,
        );
      }),
    ).toThrow(/explicit PII stance/);
  });

  test('piiFields: {} throws, recommending piiFields: "none"', () => {
    expect(() =>
      defineFeature("mailer", (r) => {
        r.defineEvent("attempt", attemptSchema, { piiFields: {} });
      }),
    ).toThrow(/use piiFields: "none"/);
  });

  test('piiFields: "none" registers successfully and stays out of the catalog', () => {
    const feature = defineFeature("mailer", (r) => {
      r.defineEvent("attempt", attemptSchema, { piiFields: "none" });
    });
    createRegistry([feature]);
    expect(configuredEventPiiCatalog().has(EVENT_TYPE)).toBe(false);
  });

  test('personal: "tenant" needs only the pii field itself on the schema, no owner field', () => {
    const feature = defineFeature("mailer", (r) => {
      r.defineEvent("attempt", attemptSchema, {
        piiFields: { recipientAddress: { personal: "tenant" } },
      });
    });
    createRegistry([feature]);
    expect(configuredEventPiiCatalog().get(EVENT_TYPE)).toEqual({
      recipientAddress: { personal: "tenant" },
    });
  });

  test('personal: "self" needs only the pii field itself on the schema, no owner field', () => {
    const feature = defineFeature("mailer", (r) => {
      r.defineEvent("attempt", attemptSchema, {
        piiFields: { recipientAddress: { personal: "self" } },
      });
    });
    createRegistry([feature]);
    expect(configuredEventPiiCatalog().get(EVENT_TYPE)).toEqual({
      recipientAddress: { personal: "self" },
    });
  });

  test('personal: "tenant" on a field not in the schema throws', () => {
    expect(() =>
      defineFeature("mailer", (r) => {
        r.defineEvent("attempt", attemptSchema, { piiFields: { nope: { personal: "tenant" } } });
      }),
    ).toThrow(/piiFields references "nope"/);
  });

  test('personal: "self" on a field not in the schema throws', () => {
    expect(() =>
      defineFeature("mailer", (r) => {
        r.defineEvent("attempt", attemptSchema, { piiFields: { nope: { personal: "self" } } });
      }),
    ).toThrow(/piiFields references "nope"/);
  });
});

describe("encryptEventPayloadPii", () => {
  const payload = { recipientId: "u-1", recipientAddress: "u1@example.com", status: "sent" };

  test("uncatalogued event type returns the payload untouched (same reference)", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    expect(await encryptEventPayloadPii("other:event:x", payload, ENVELOPE)).toBe(payload);
  });

  test("no KMS configured → plaintext passthrough (rollout mode)", async () => {
    catalogWithAttempt();
    expect(await encryptEventPayloadPii(EVENT_TYPE, payload, ENVELOPE)).toBe(payload);
  });

  test("encrypts under the subject's DEK; subject fk stays plaintext", async () => {
    catalogWithAttempt();
    const kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);

    const out = await encryptEventPayloadPii(EVENT_TYPE, payload, ENVELOPE);
    expect(isPiiCiphertext(out["recipientAddress"])).toBe(true);
    expect(String(out["recipientAddress"])).toContain("user:u-1");
    expect(out["recipientId"]).toBe("u-1");
    expect(out["status"]).toBe("sent");

    const back = await decryptPiiFieldValues(out, ["recipientAddress"], kms, {
      requestId: "test",
    });
    expect(back["recipientAddress"]).toBe("u1@example.com");
  });

  test("legacy subjectField and canonical personal.of encrypt under the same subject key", async () => {
    const LEGACY_TYPE = "mailer:event:legacy-attempt";
    const CANONICAL_TYPE = "mailer:event:canonical-attempt";
    configureEventPiiCatalog(
      new Map([
        [LEGACY_TYPE, { recipientAddress: { subjectField: "recipientId" } }],
        [CANONICAL_TYPE, { recipientAddress: { personal: { of: "recipientId" } } }],
      ]),
    );
    configurePiiSubjectKms(new InMemoryKmsAdapter());

    const legacy = await encryptEventPayloadPii(LEGACY_TYPE, payload, ENVELOPE);
    const canonical = await encryptEventPayloadPii(CANONICAL_TYPE, payload, ENVELOPE);
    expect(String(legacy["recipientAddress"])).toContain("user:u-1");
    expect(String(canonical["recipientAddress"])).toContain("user:u-1");
  });

  test("null subject field → value stays plaintext (no user key to shred)", async () => {
    catalogWithAttempt();
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const systemPayload = {
      recipientId: null,
      recipientAddress: "ops@example.com",
      status: "sent",
    };
    expect(await encryptEventPayloadPii(EVENT_TYPE, systemPayload, ENVELOPE)).toBe(systemPayload);
  });

  test("null pii value passes through", async () => {
    catalogWithAttempt();
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const skipped = { recipientId: "u-1", recipientAddress: null, status: "skipped" };
    expect(await encryptEventPayloadPii(EVENT_TYPE, skipped, ENVELOPE)).toBe(skipped);
  });

  test("idempotent: ciphertext and erased sentinel stay as-is", async () => {
    catalogWithAttempt();
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const once = await encryptEventPayloadPii(EVENT_TYPE, payload, ENVELOPE);
    const twice = await encryptEventPayloadPii(EVENT_TYPE, once, ENVELOPE);
    expect(twice["recipientAddress"]).toBe(once["recipientAddress"]);

    const erased = { ...payload, recipientAddress: PII_ERASED_SENTINEL };
    const out = await encryptEventPayloadPii(EVENT_TYPE, erased, ENVELOPE);
    expect(out["recipientAddress"]).toBe(PII_ERASED_SENTINEL);
  });

  test("non-string pii value is a loud error, not a silent skip", async () => {
    catalogWithAttempt();
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const broken = { recipientId: "u-1", recipientAddress: 42, status: "sent" };
    expect(encryptEventPayloadPii(EVENT_TYPE, broken, ENVELOPE)).rejects.toThrow(
      /must be a string/,
    );
  });

  test('personal: "tenant" encrypts under the envelope tenantId, not a payload field', async () => {
    configureEventPiiCatalog(new Map([[EVENT_TYPE, { recipientAddress: { personal: "tenant" } }]]));
    configurePiiSubjectKms(new InMemoryKmsAdapter());

    const out = await encryptEventPayloadPii(EVENT_TYPE, payload, ENVELOPE);
    expect(isPiiCiphertext(out["recipientAddress"])).toBe(true);
    expect(String(out["recipientAddress"])).toContain(`tenant:${ENVELOPE.tenantId}`);
  });

  test('personal: "self" encrypts under the envelope aggregateType:aggregateId', async () => {
    configureEventPiiCatalog(new Map([[EVENT_TYPE, { recipientAddress: { personal: "self" } }]]));
    configurePiiSubjectKms(new InMemoryKmsAdapter());

    const out = await encryptEventPayloadPii(EVENT_TYPE, payload, ENVELOPE);
    expect(isPiiCiphertext(out["recipientAddress"])).toBe(true);
    expect(String(out["recipientAddress"])).toContain(
      `record:${ENVELOPE.aggregateType}:${ENVELOPE.aggregateId}`,
    );
  });
});
