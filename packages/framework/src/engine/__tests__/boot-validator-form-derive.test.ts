import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import type { FormFieldDerivation } from "@cosmicdrift/kumiko-types/screen";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";
import { createEmbeddedListField, createTextField } from "../factories.ts";

import { withFormDerivations } from "../with-form-derivations.ts";

const currency = { kind: "literal", code: "EUR" } as const;

const fields = {
  note: createTextField({ personal: false, reason: "test fixture" }),
  lines: createEmbeddedListField({
    amount: { type: "money", required: true },
    label: { type: "text" },
  }),
  single: { type: "embedded", schema: { amount: { type: "money" } } },
  net: { type: "money", currency },
  vat: { type: "money", currency },
  gross: { type: "money", currency },
  rate: { type: "decimal", precision: 5, scale: 2 },
  count: { type: "number" },
  plain: { type: "number" },
} as const;

type Wrap = "own" | "foreign" | "none";

function boot(derive: Record<string, FormFieldDerivation>, wrap: Wrap = "own"): void {
  const screen = {
    id: "receive",
    type: "actionForm",
    handler: "shop:write:receive",
    fields,
    derive,
    layout: { sections: [{ fields: Object.keys(fields) }] } as never,
  } as const;
  const base = z.object({});
  const schema =
    wrap === "none"
      ? base
      : withFormDerivations(base, wrap === "own" ? screen : { fields, derive: { ...derive } });
  const feature = defineFeature("shop", (r) => {
    r.writeHandler({
      name: "receive",
      schema,
      handler: async () => ({ isSuccess: true, data: {} }) as never,
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    r.screen(screen);
  });
  validateBootRaw(withBootValidatorFixture([feature]));
}

describe("validateBoot — actionForm derive", () => {
  test("a valid listSum with whenEmpty and a sum boots", () => {
    expect(() =>
      boot({
        net: { op: "listSum", list: "lines", cell: "amount" },
        vat: {
          op: "listSum",
          list: "lines",
          cell: "amount",
          whenEmpty: { op: "percent", from: ["net", "rate"] },
        },
        gross: { op: "sum", from: ["net", "vat"] },
      }),
    ).not.toThrow();
  });

  const validDerive: Record<string, FormFieldDerivation> = {
    net: { op: "listSum", list: "lines", cell: "amount" },
  };

  test("rejects a handler schema that is not wrapped with withFormDerivations", () => {
    expect(() => boot(validDerive, "none")).toThrow(/withFormDerivations\(schema, screen\)/);
  });

  test("rejects a handler schema wrapped with another screen's derive", () => {
    expect(() => boot(validDerive, "foreign")).toThrow(/withFormDerivations\(schema, screen\)/);
  });

  const rejected: readonly (readonly [string, Record<string, FormFieldDerivation>, RegExp])[] = [
    ["unknown target key", { ghost: { op: "sum", from: ["net"] } }, /key "ghost" is not a field/],
    [
      "non-numeric target",
      { note: { op: "sum", from: ["net"] } },
      /must be money, number or decimal/,
    ],
    ["unknown source", { net: { op: "sum", from: ["ghost"] } }, /unknown source field "ghost"/],
    [
      "percent with three sources",
      { net: { op: "percent", from: ["vat", "gross", "vat"] } },
      /exactly two sources/,
    ],
    [
      "unknown list",
      { net: { op: "listSum", list: "ghost", cell: "amount" } },
      /unknown list field/,
    ],
    [
      "list is not an embedded list",
      { net: { op: "listSum", list: "single", cell: "amount" } },
      /embedded list field/,
    ],
    [
      "cell is not numeric",
      { net: { op: "listSum", list: "lines", cell: "label" } },
      /money, number or decimal sub-field/,
    ],
    [
      "text source",
      { net: { op: "sum", from: ["note"] } },
      /source "note" must be money, number or decimal/,
    ],
    [
      "sum over money and number",
      { net: { op: "sum", from: ["vat", "plain"] } },
      /all money or all number\/decimal/,
    ],
    [
      "money sum into a number target",
      { count: { op: "sum", from: ["vat", "gross"] } },
      /needs a money target/,
    ],
    [
      "number sum into a money target",
      { net: { op: "sum", from: ["plain", "count"] } },
      /needs a number\/decimal target/,
    ],
    [
      "multiply of two money sources",
      { net: { op: "multiply", from: ["vat", "gross"] } },
      /at most one money source/,
    ],
    [
      "percent with a money rate",
      { net: { op: "percent", from: ["rate", "vat"] } },
      /not the rate/,
    ],
    [
      "money multiply into a number target",
      { count: { op: "multiply", from: ["vat", "plain"] } },
      /money exactly when/,
    ],
    [
      "listSum of a money cell into a number target",
      { count: { op: "listSum", list: "lines", cell: "amount" } },
      /needs a money target/,
    ],
    ["cycle", { net: { op: "sum", from: ["vat"] }, vat: { op: "sum", from: ["net"] } }, /cycle/],
  ];
  test.each(rejected)("rejects %s", (_name, derive, message) => {
    expect(() => boot(derive)).toThrow(message);
  });

  test("rejects a nested listSum in whenEmpty", () => {
    const nested = {
      op: "listSum",
      list: "lines",
      cell: "amount",
      whenEmpty: { op: "listSum", list: "lines", cell: "amount" },
    } as unknown as FormFieldDerivation;
    expect(() => boot({ net: nested })).toThrow(/whenEmpty must not be a listSum/);
  });
});
