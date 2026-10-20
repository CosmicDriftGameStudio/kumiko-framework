import { describe, expect, test } from "bun:test";
import { validationErrorFromZod } from "../../errors/zod-bridge.ts";
import { createEntity, createTextField } from "../factories.ts";
import { isValidIban, normalizeIban } from "../iban.ts";
import { buildInsertSchema } from "../schema-builder.ts";

describe("isValidIban", () => {
  test.each([
    ["DE89370400440532013000"],
    ["DE89 3704 0044 0532 0130 00"],
    ["de89370400440532013000"],
    ["GB82 WEST 1234 5698 7654 32"],
    ["FR1420041010050500013M02606"],
  ])("accepts %s", (value) => {
    expect(isValidIban(value)).toBe(true);
  });

  test.each([
    ["wrong check digits", "DE88370400440532013000"],
    ["too short", "DE89 3704"],
    ["letters in the check digits", "DEXX370400440532013000"],
    ["too long", `DE89${"0".repeat(31)}`],
    ["empty", ""],
    ["symbols", "DE89-3704-0044-0532-0130-00"],
  ])("rejects %s", (_label, value) => {
    expect(isValidIban(value)).toBe(false);
  });

  test("normalizeIban drops whitespace and uppercases", () => {
    expect(normalizeIban(" de89 3704\t0044 0532 0130 00 ")).toBe("DE89370400440532013000");
  });
});

describe("text field format iban", () => {
  const entity = createEntity({
    table: "bank_account",
    fields: {
      iban: createTextField({ format: "iban", personal: false, reason: "test_fixture" }),
      other: createTextField({
        format: "iban",
        required: true,
        personal: false,
        reason: "test_fixture",
      }),
    },
  });
  const schema = buildInsertSchema(entity);

  test("a valid value with spaces passes and is stored as typed", () => {
    const parsed = schema.safeParse({
      iban: "DE89 3704 0044 0532 0130 00",
      other: "DE89370400440532013000",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data["iban"]).toBe("DE89 3704 0044 0532 0130 00");
  });

  test("a wrong check digit fails as invalid_format with format iban", () => {
    const parsed = schema.safeParse({
      iban: "DE88370400440532013000",
      other: "DE89370400440532013000",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issue = parsed.error.issues.find((i) => i.path[0] === "iban");
    expect(issue).toMatchObject({ code: "invalid_format", format: "iban" });
    expect(validationErrorFromZod(parsed.error).details).toMatchObject({
      fields: expect.arrayContaining([
        {
          path: "iban",
          code: "invalid_format",
          i18nKey: "errors.validation.invalid_format",
          params: { format: "iban" },
        },
      ]),
    });
  });

  test("an empty optional value stays valid, an empty required one does not", () => {
    expect(schema.safeParse({ iban: "", other: "DE89370400440532013000" }).success).toBe(true);
    expect(schema.safeParse({ iban: "", other: "" }).success).toBe(false);
  });
});
