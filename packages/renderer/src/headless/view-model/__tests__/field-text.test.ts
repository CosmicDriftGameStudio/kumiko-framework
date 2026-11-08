import { describe, expect, test } from "bun:test";
import { resolveFieldText } from "../field-text.ts";

const translate = (key: string, params?: Readonly<Record<string, unknown>>): string =>
  `${key}|${JSON.stringify(params ?? {})}`;

describe("resolveFieldText", () => {
  test("a plain key is translated as is and counts as complete", () => {
    expect(resolveFieldText("a.key", {}, translate)).toEqual({
      text: "a.key|{}",
      complete: true,
    });
  });

  test("params are filled from form values, hidden fields included", () => {
    const ref = { key: "a.key", params: { amount: "price", who: "buyer" } };
    expect(resolveFieldText(ref, { price: 15000, buyer: "Acme" }, translate)).toEqual({
      text: 'a.key|{"amount":"15000","who":"Acme"}',
      complete: true,
    });
  });

  test("an empty or missing param value makes the text incomplete", () => {
    const ref = { key: "a.key", params: { amount: "price" } };
    expect(resolveFieldText(ref, { price: "" }, translate).complete).toBe(false);
    expect(resolveFieldText(ref, {}, translate).complete).toBe(false);
  });
});
