import { describe, expect, test } from "bun:test";
import { templateVariable, templateVariablesToZod } from "../template-variables.ts";

const schema = templateVariablesToZod({
  name: templateVariable.text({ required: true }),
  nickname: templateVariable.text(),
  url: templateVariable.link({ required: true }),
  total: templateVariable.money(),
  dueOn: templateVariable.date(),
  lines: templateVariable.list({
    title: templateVariable.text({ required: true }),
    price: templateVariable.money(),
  }),
});

const valid = { name: "Ada", url: "https://example.com/pay" };

describe("templateVariablesToZod", () => {
  test("accepts required values and leaves optional ones out", () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  test("rejects a missing required variable", () => {
    expect(schema.safeParse({ url: valid.url }).success).toBe(false);
  });

  test("link accepts http, https, mailto and rejects javascript and garbage", () => {
    for (const url of ["http://a.test", "https://a.test/x?y=1", "mailto:a@b.test"]) {
      expect(schema.safeParse({ ...valid, url }).success).toBe(true);
    }
    for (const url of ["javascript:alert(1)", "data:text/html,x", "not a url", "/relative"]) {
      expect(schema.safeParse({ ...valid, url }).success).toBe(false);
    }
  });

  test("money accepts integer minor units or {amount, currency}", () => {
    expect(schema.safeParse({ ...valid, total: 1999 }).success).toBe(true);
    expect(schema.safeParse({ ...valid, total: { amount: 1999, currency: "EUR" } }).success).toBe(
      true,
    );
    expect(schema.safeParse({ ...valid, total: 19.99 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, total: { amount: 1, currency: "eur" } }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...valid, total: "12" }).success).toBe(false);
  });

  test("date accepts ISO date and datetime strings only", () => {
    expect(schema.safeParse({ ...valid, dueOn: "2026-10-15" }).success).toBe(true);
    expect(schema.safeParse({ ...valid, dueOn: "2026-10-15T10:00:00Z" }).success).toBe(true);
    expect(schema.safeParse({ ...valid, dueOn: "15.10.2026" }).success).toBe(false);
  });

  test("list validates every row against the item schema", () => {
    expect(
      schema.safeParse({ ...valid, lines: [{ title: "A", price: 100 }, { title: "B" }] }).success,
    ).toBe(true);
    expect(schema.safeParse({ ...valid, lines: [{ price: 100 }] }).success).toBe(false);
    expect(schema.safeParse({ ...valid, lines: "nope" }).success).toBe(false);
  });
});

describe("templateVariable builders", () => {
  test("carry the discriminant and options", () => {
    expect(templateVariable.text({ label: "Name", example: "Ada" })).toEqual({
      type: "text",
      label: "Name",
      example: "Ada",
    });
    expect(templateVariable.list({ a: templateVariable.text() }).type).toBe("list");
  });
});
