import { describe, expect, expectTypeOf, test } from "bun:test";
import * as z from "zod";
import { storedEventPayloadSchema } from "../stored-event-payload-schema.ts";

const eventSchema = z.object({
  applicationId: z.uuid(),
  salutation: z.enum(["mr", "ms"]).nullish(),
  email: z.email().max(254),
  note: z.string().max(5).optional(),
  lastName: z.string().min(1).max(10),
});

const piiFields = {
  salutation: { personal: "self" },
  email: { personal: "self" },
  note: { personal: "self" },
  lastName: { personal: "self" },
} as const;

const storedSchema = storedEventPayloadSchema(eventSchema, piiFields);

const APPLICATION_ID = "0b1f6a52-3c1d-4f4e-8a6b-2f1f6a52c1d4";
const ciphertext = (label: string) => `v1:kms:${label}${"AbCdEf0123456789".repeat(20)}`;

describe("storedEventPayloadSchema", () => {
  test("accepts ciphertext-like strings the write-side schema rejects", () => {
    const payload = {
      applicationId: APPLICATION_ID,
      salutation: ciphertext("s"),
      email: ciphertext("e"),
      note: ciphertext("n"),
      lastName: ciphertext("l"),
    };
    expect(eventSchema.safeParse(payload).success).toBe(false);
    const parsed = storedSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(payload);
  });

  test("keeps non-PII fields strict", () => {
    const result = storedSchema.safeParse({
      applicationId: "not-a-uuid",
      email: ciphertext("e"),
      lastName: ciphertext("l"),
    });
    expect(result.success).toBe(false);
  });

  test("keeps the optional and nullable stance of each personal field", () => {
    const base = { applicationId: APPLICATION_ID, email: "x", lastName: "y" };
    expect(storedSchema.safeParse({ ...base, email: undefined }).success).toBe(false);
    expect(storedSchema.safeParse({ ...base, lastName: undefined }).success).toBe(false);
    expect(storedSchema.safeParse({ ...base, salutation: null }).success).toBe(true);
    expect(storedSchema.safeParse(base).success).toBe(true);
    expect(storedSchema.safeParse({ ...base, note: undefined }).success).toBe(true);
    expect(storedSchema.safeParse({ ...base, note: null }).success).toBe(false);
  });

  test("output types follow the stance", () => {
    type Stored = z.output<typeof storedSchema>;
    expectTypeOf<Stored["salutation"]>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<Stored["email"]>().toEqualTypeOf<string>();
    expectTypeOf<Stored["note"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Stored["applicationId"]>().toEqualTypeOf<string>();
  });
});
