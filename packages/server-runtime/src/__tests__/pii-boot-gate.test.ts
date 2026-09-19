import { describe, expect, test } from "bun:test";
import { InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { assertPiiBootInvariants } from "../pii-boot-gate";

const piiFeature = defineFeature("gate-pii", (r) => {
  r.entity(
    "person",
    createEntity({
      table: "read_gate_persons",
      fields: { email: createTextField({ required: true, personal: "self", find: "exact" }) },
    }),
  );
});
const plainFeature = defineFeature("gate-plain", (r) => {
  r.entity(
    "thing",
    createEntity({
      table: "read_gate_things",
      fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
    }),
  );
});

// Entity-free features: the gate must react to the event stance on its own,
// not ride along on an entity annotation (fw#2776).
const piiEventFeature = defineFeature("gate-pii-event", (r) => {
  r.defineEvent("attempt", z.object({ userId: z.string(), email: z.string() }), {
    piiFields: { email: { personal: { of: "userId" } } },
  });
});
const noneEventFeature = defineFeature("gate-none-event", (r) => {
  r.defineEvent("ping", z.object({ at: z.string() }), { piiFields: "none" });
});

const kms = new InMemoryKmsAdapter();
const KEY = Buffer.alloc(32, 7).toString("base64");

describe("assertPiiBootInvariants — prod", () => {
  test("PII without a KMS aborts boot", () => {
    expect(() => assertPiiBootInvariants([piiFeature], { mode: "prod" })).toThrow(
      /BOOT ABORTED.*PLAINTEXT.*allowPlaintextPii/s,
    );
  });

  test("explicit allowPlaintextPii downgrades to a warning", () => {
    expect(() =>
      assertPiiBootInvariants([piiFeature], {
        mode: "prod",
        allowPlaintextPii: "kms rollout pending, infra#188",
      }),
    ).not.toThrow();
  });

  test("KMS + blindIndexKey boots", () => {
    expect(() =>
      assertPiiBootInvariants([piiFeature], { mode: "prod", kms, blindIndexKey: KEY }),
    ).not.toThrow();
  });

  test("KMS without blindIndexKey aborts when lookupable fields exist", () => {
    expect(() => assertPiiBootInvariants([piiFeature], { mode: "prod", kms })).toThrow(
      /blindIndexKey/,
    );
  });

  test("no PII entities → nothing to gate", () => {
    expect(() => assertPiiBootInvariants([plainFeature], { mode: "prod" })).not.toThrow();
  });

  test('an entity-free feature with a non-"none" event stance aborts boot without a KMS', () => {
    expect(() => assertPiiBootInvariants([piiEventFeature], { mode: "prod" })).toThrow(
      /BOOT ABORTED.*gate-pii-event:event:attempt.*PLAINTEXT/s,
    );
  });

  test('events declaring piiFields: "none" are not gated', () => {
    expect(() => assertPiiBootInvariants([noneEventFeature], { mode: "prod" })).not.toThrow();
  });

  test("a KMS satisfies the event gate", () => {
    expect(() =>
      assertPiiBootInvariants([piiEventFeature], { mode: "prod", kms, blindIndexKey: KEY }),
    ).not.toThrow();
  });

  test("allowPlaintextPii acknowledges the event gate too", () => {
    expect(() =>
      assertPiiBootInvariants([piiEventFeature], {
        mode: "prod",
        allowPlaintextPii: "kms rollout pending",
      }),
    ).not.toThrow();
  });
});

describe("assertPiiBootInvariants — dev", () => {
  test("PII without a KMS only warns in dev", () => {
    expect(() => assertPiiBootInvariants([piiFeature], { mode: "dev" })).not.toThrow();
  });

  test("KMS without blindIndexKey aborts in dev too (lookups broken in any mode)", () => {
    expect(() => assertPiiBootInvariants([piiFeature], { mode: "dev", kms })).toThrow(
      /blindIndexKey/,
    );
  });

  test("a PII event without a KMS only warns in dev", () => {
    expect(() => assertPiiBootInvariants([piiEventFeature], { mode: "dev" })).not.toThrow();
  });
});
