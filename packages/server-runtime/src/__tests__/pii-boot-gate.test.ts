import { describe, expect, test } from "bun:test";
import { InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { assertPiiBootInvariants } from "../pii-boot-gate";

const piiFeature = defineFeature("gate-pii", (r) => {
  r.entity(
    "person",
    createEntity({
      table: "read_gate_persons",
      fields: { email: createTextField({ required: true, pii: true, lookupable: true }) },
    }),
  );
});
const plainFeature = defineFeature("gate-plain", (r) => {
  r.entity(
    "thing",
    createEntity({ table: "read_gate_things", fields: { name: createTextField() } }),
  );
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
});
