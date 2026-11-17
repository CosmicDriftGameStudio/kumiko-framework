import { afterEach, describe, expect, test } from "bun:test";
import * as z from "zod";
import { InMemoryKmsAdapter } from "../../crypto/in-memory-kms-adapter.ts";
import {
  configurePiiSubjectKms,
  encryptPiiValueForSubject,
  PII_ERASED_SENTINEL,
  resetPiiSubjectKmsForTests,
} from "../../crypto/pii-field-encryption.ts";
import { InternalError } from "../../errors/index.ts";
import { createEventDef } from "../event-def.ts";
import { triggeredEventOf } from "../triggered-event.ts";

const opened = createEventDef({
  feature: "shop",
  name: "order-opened",
  schema: z.object({ id: z.string() }),
  piiFields: "none",
});
const cancelled = createEventDef({
  feature: "shop",
  name: "order-cancelled",
  schema: z.object({ id: z.string(), reason: z.string() }),
  piiFields: "none",
});
const contacted = createEventDef({
  feature: "shop",
  name: "customer-contacted",
  schema: z.object({ email: z.string(), ownerId: z.string() }),
  piiFields: { email: { personal: { of: "ownerId" } } },
});

const subject = { kind: "user", userId: "u-1" } as const;
const kmsCtx = { requestId: "test" };
const contactedCtx = { triggerName: "shop:event:customer-contacted" };

afterEach(() => resetPiiSubjectKmsForTests());

describe("triggeredEventOf", () => {
  test("parses the payload against the event named by ctx.triggerName", async () => {
    const result = await triggeredEventOf(
      [opened, cancelled],
      { id: "o-1", reason: "late" },
      { triggerName: "shop:event:order-cancelled" },
    );
    expect(result).toEqual({
      type: "shop:event:order-cancelled",
      payload: { id: "o-1", reason: "late" },
    });
    if (result.type === "shop:event:order-cancelled") {
      expect(result.payload.reason).toBe("late");
    }
  });

  test("a trigger outside the list throws", async () => {
    await expect(
      triggeredEventOf([opened, cancelled], { id: "o-1" }, { triggerName: "shop:event:other" }),
    ).rejects.toThrow(InternalError);
    await expect(
      triggeredEventOf([opened, cancelled], { id: "o-1" }, { triggerName: "shop:event:other" }),
    ).rejects.toThrow(/is none of/);
  });

  test("an undefined triggerName throws", async () => {
    await expect(triggeredEventOf([opened, cancelled], { id: "o-1" }, {})).rejects.toThrow(
      InternalError,
    );
  });

  test("a payload that does not match the schema throws", async () => {
    const call = () =>
      triggeredEventOf([opened], { id: 5 }, { triggerName: "shop:event:order-opened" });
    await expect(call()).rejects.toThrow(InternalError);
    await expect(call()).rejects.toThrow(/does not match its schema/);
  });

  test("decrypts catalogued personal fields with the subject KMS", async () => {
    const kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
    const cipher = await encryptPiiValueForSubject(kms, subject, "ada@example.com", kmsCtx, "email");
    expect(cipher).not.toBe("ada@example.com");
    const result = await triggeredEventOf(
      [contacted],
      { email: cipher, ownerId: "u-1" },
      contactedCtx,
    );
    expect(result.payload).toEqual({ email: "ada@example.com", ownerId: "u-1" });
  });

  test("an erased subject yields the erased sentinel", async () => {
    const kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
    const cipher = await encryptPiiValueForSubject(kms, subject, "ada@example.com", kmsCtx, "email");
    await kms.eraseKey(subject);
    const result = await triggeredEventOf(
      [contacted],
      { email: cipher, ownerId: "u-1" },
      contactedCtx,
    );
    expect(result.payload.email).toBe(PII_ERASED_SENTINEL);
  });

  test("ciphertext without a subject KMS throws", async () => {
    const kms = new InMemoryKmsAdapter();
    const cipher = await encryptPiiValueForSubject(kms, subject, "ada@example.com", kmsCtx, "email");
    resetPiiSubjectKmsForTests();
    await expect(
      triggeredEventOf([contacted], { email: cipher, ownerId: "u-1" }, contactedCtx),
    ).rejects.toThrow(/no subject KMS is configured/);
  });

  test("plaintext personal fields pass without a subject KMS", async () => {
    const result = await triggeredEventOf(
      [contacted],
      { email: "ada@example.com", ownerId: "u-1" },
      contactedCtx,
    );
    expect(result.payload).toEqual({ email: "ada@example.com", ownerId: "u-1" });
  });
});
