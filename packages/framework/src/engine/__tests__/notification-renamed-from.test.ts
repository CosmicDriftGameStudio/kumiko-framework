import { describe, expect, test } from "bun:test";
import { defineFeature } from "../define-feature.ts";
import { createRegistry } from "../registry.ts";

function mailer(feature: string, name: string, renamedFrom?: readonly string[]) {
  return defineFeature(feature, (r) => {
    r.notification(name, renamedFrom === undefined ? {} : { renamedFrom });
  });
}

describe("r.notification renamedFrom", () => {
  test("declared former names land on the registered notification", () => {
    const registry = createRegistry([mailer("shop", "invoice-ready", ["shop:notify:invoice"])]);
    expect(registry.getAllNotifications().get("shop:notify:invoice-ready")?.renamedFrom).toEqual([
      "shop:notify:invoice",
    ]);
  });

  test("the object form accepts renamedFrom too", () => {
    const feature = defineFeature("shop", (r) => {
      r.notification({ name: "invoice-ready", renamedFrom: ["shop:notify:invoice"] });
    });
    expect(
      createRegistry([feature]).getAllNotifications().get("shop:notify:invoice-ready")?.renamedFrom,
    ).toEqual(["shop:notify:invoice"]);
  });

  test("an alias equal to the notification's own name is rejected", () => {
    expect(() =>
      createRegistry([mailer("shop", "invoice-ready", ["shop:notify:invoice-ready"])]),
    ).toThrow(/shop:notify:invoice-ready.*current notification name/);
  });

  test("an alias equal to another current notification name is rejected", () => {
    expect(() =>
      createRegistry([
        mailer("shop", "invoice-ready", ["orders:notify:order-shipped"]),
        mailer("orders", "order-shipped"),
      ]),
    ).toThrow(/current notification name/);
  });

  test('the wildcard "*" is rejected as an alias', () => {
    expect(() => createRegistry([mailer("shop", "invoice-ready", ["*"])])).toThrow(/wildcard/);
  });

  test("an alias claimed by two notifications is rejected and names both", () => {
    expect(() =>
      createRegistry([
        mailer("shop", "invoice-ready", ["shop:notify:invoice"]),
        mailer("billing", "invoice-sent", ["shop:notify:invoice"]),
      ]),
    ).toThrow(
      /shop:notify:invoice-ready.*billing:notify:invoice-sent|billing:notify:invoice-sent.*shop:notify:invoice-ready/,
    );
  });
});
