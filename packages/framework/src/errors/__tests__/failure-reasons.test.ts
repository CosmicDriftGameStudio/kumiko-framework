import { describe, expect, test } from "bun:test";
import { defineFailureReasons } from "../failure-reasons.ts";

const table = defineFailureReasons("orders", {
  alreadyPaid: { en: "Already paid.", de: "Bereits bezahlt." },
  cartIsEmpty: { en: "Empty cart.", de: "Leerer Warenkorb." },
});

describe("defineFailureReasons", () => {
  test("reasonOf turns the camelCase name into its snake_case slug", () => {
    expect(table.reasonOf("alreadyPaid")).toBe("already_paid");
  });

  test("translationKeys maps <feature>.errors.<name> to the texts", () => {
    expect(table.translationKeys).toEqual({
      "orders.errors.alreadyPaid": { en: "Already paid.", de: "Bereits bezahlt." },
      "orders.errors.cartIsEmpty": { en: "Empty cart.", de: "Leerer Warenkorb." },
    });
  });

  test("fail builds a 422 with slug, i18n key, details and params", () => {
    const failure = table.fail("alreadyPaid", { orderId: "o1" }, { amount: 3 });
    expect(failure.isSuccess).toBe(false);
    expect(failure.error.code).toBe("unprocessable");
    expect(failure.error.httpStatus).toBe(422);
    expect(failure.error.i18nKey).toBe("orders.errors.alreadyPaid");
    expect(failure.error.details).toEqual({ orderId: "o1", reason: "already_paid" });
    expect(failure.error.i18nParams).toEqual({ amount: 3 });
  });

  test("fail without details carries only the reason and no i18nParams", () => {
    const failure = table.fail("cartIsEmpty");
    expect(failure.error.details).toEqual({ reason: "cart_is_empty" });
    expect(failure.error.i18nParams).toBeUndefined();
  });
});
