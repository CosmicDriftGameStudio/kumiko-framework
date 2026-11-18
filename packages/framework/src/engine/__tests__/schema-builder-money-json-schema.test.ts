import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { createEmbeddedListField, createEntity, createMoneyField } from "../factories.ts";
import { buildInsertSchema, buildUpdateSchema, fieldToZod } from "../schema-builder.ts";

describe("money JSON Schema", () => {
  // An agent tool only sees the JSON Schema; without the unit it writes 12500 for "12,500 GBP".
  test("money amount is described as minor units in the JSON Schema of create, update and payload", () => {
    const entity = createEntity({
      name: "entity",
      table: "Test",
      fields: {
        price: createMoneyField({ required: true, description: "The asking price." }),
        lines: createEmbeddedListField({ amount: { type: "money", required: true } }),
      },
      defaultCurrency: "GBP",
    });
    const at = (node: unknown, path: readonly string[]): unknown =>
      path.reduce<unknown>(
        (current, key) =>
          typeof current === "object" && current !== null ? Reflect.get(current, key) : undefined,
        node,
      );
    const amountPath = ["properties", "price", "properties", "amount", "description"];
    const insertJson = z.toJSONSchema(buildInsertSchema(entity), { io: "input" });
    const updateJson = z.toJSONSchema(buildUpdateSchema(entity), { io: "input" });
    const price = entity.fields["price"];
    if (price === undefined) throw new Error("price field missing");
    const payloadJson = z.toJSONSchema(fieldToZod(price, ["GBP"], { applyDefaults: false }));

    expect(at(insertJson, amountPath)).toContain("minor units");
    expect(at(updateJson, amountPath)).toContain("minor units");
    expect(at(payloadJson, ["properties", "amount", "description"])).toContain("minor units");
    expect(
      at(insertJson, ["properties", "lines", "items", "properties", "amount", "description"]),
    ).toContain("minor units");
  });
});
