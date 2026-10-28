import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import type { DerivedFieldDef, EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { validateSqlDerivedFields } from "../boot-validator/derived-sql-fields.ts";
import { validateBoot as validateBootRaw } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";
import {
  createDateField,
  createDerivedField,
  createEntity,
  createMoneyField,
  createNumberField,
  createTextField,
} from "../factories.ts";

const text = () => createTextField({ personal: false, reason: "test_fixture" });

const childFields = {
  unitId: { type: "reference", entity: "unit" },
  status: text(),
  title: text(),
  amount: createMoneyField(),
  secret: createTextField({ personal: false, reason: "test_fixture", encrypted: true }),
  startsOn: createDateField(),
  endsOn: createDateField(),
  rank: createNumberField(),
  assigneeId: { type: "reference", entity: "unit", labelField: "name" },
  plainRef: { type: "reference", entity: "unit" },
} as const;

function validateWith(derivedFields: Record<string, DerivedFieldDef>): void {
  const unit: EntityDefinition = createEntity({
    table: "units",
    fields: { name: text(), nickname: text(), floor: createNumberField() },
    derivedFields,
  });
  const child: EntityDefinition = createEntity({ table: "children", fields: childFields });
  const feature = defineFeature("demo", (r) => {
    r.entity({ name: "unit", ...unit });
    r.entity({ name: "child", ...child });
  });
  validateSqlDerivedFields([feature]);
}

const related = (
  overrides: Partial<{
    entity: string;
    on: { field: string; outer?: string };
    measure: Extract<DerivedFieldDef, { sql: unknown }>["sql"] extends infer S
      ? S extends { kind: "related"; measure: infer M }
        ? M
        : never
      : never;
    where: never[];
  }>,
  valueType: "number" | "text" | "date" | "money" = "number",
): DerivedFieldDef =>
  createDerivedField({
    valueType,
    sql: {
      kind: "related",
      entity: "child",
      on: { field: "unitId" },
      measure: { kind: "count" },
      ...overrides,
    },
  });

describe("validateSqlDerivedFields", () => {
  test("accepts well-formed related and coalesce definitions", () => {
    expect(() =>
      validateWith({
        children: related({}),
        latestStatus: related(
          { measure: { kind: "first", field: "status", orderBy: "rank", direction: "desc" } },
          "text",
        ),
        assignee: related(
          {
            measure: {
              kind: "first",
              field: "assigneeId",
              orderBy: "rank",
              direction: "asc",
              label: true,
            },
          },
          "text",
        ),
        shown: createDerivedField({
          valueType: "text",
          sortable: true,
          sql: { kind: "coalesce", fields: ["nickname", "name"] },
        }),
      }),
    ).not.toThrow();
  });

  test("rejects an unregistered related entity", () => {
    expect(() => validateWith({ n: related({ entity: "ghost" }) })).toThrow(
      /derived field "n".*related entity "ghost" is not registered/,
    );
  });

  test("rejects an unknown on.field", () => {
    expect(() => validateWith({ n: related({ on: { field: "nope" } }) })).toThrow(
      /on\.field "nope" is not a field/,
    );
  });

  test("rejects an unknown on.outer", () => {
    expect(() => validateWith({ n: related({ on: { field: "unitId", outer: "nope" } }) })).toThrow(
      /on\.outer "nope" is not a field/,
    );
  });

  test("rejects a money field anywhere in the definition", () => {
    expect(() =>
      validateWith({
        n: related({ measure: { kind: "countDistinct", field: "amount" } }),
      }),
    ).toThrow(/measure field "amount".*money/);
  });

  describe("money", () => {
    const firstAmount = {
      kind: "first",
      field: "amount",
      orderBy: "rank",
      direction: "desc",
    } as const;

    test("accepts related first on a money field with valueType money", () => {
      expect(() =>
        validateWith({ rent: related({ measure: firstAmount }, "money") }),
      ).not.toThrow();
    });

    test("rejects a money field with another valueType", () => {
      expect(() => validateWith({ rent: related({ measure: firstAmount }, "number") })).toThrow(
        /valueType must be "money", got "number"/,
      );
    });

    test("rejects valueType money on a non-money measure", () => {
      expect(() =>
        validateWith({
          n: related(
            { measure: { kind: "first", field: "title", orderBy: "rank", direction: "asc" } },
            "money",
          ),
        }),
      ).toThrow(/valueType must be "text", got "money"/);
      expect(() => validateWith({ n: related({}, "money") })).toThrow(
        /valueType must be "number", got "money"/,
      );
    });

    test("rejects label on a money field", () => {
      expect(() =>
        validateWith({
          rent: related({ measure: { ...firstAmount, label: true } }, "money"),
        }),
      ).toThrow(/label: true needs a reference field, not money/);
    });

    test("rejects money in coalesce and valueType money on a JS derive", () => {
      expect(() =>
        validateWith({
          n: createDerivedField({
            valueType: "money",
            sql: { kind: "coalesce", fields: ["name"] },
          }),
        }),
      ).toThrow(/valueType must be "text", got "money"/);
      expect(() =>
        validateWith({ n: createDerivedField({ valueType: "money", derive: () => 1 }) }),
      ).toThrow(/needs a sql derived field/);
    });
  });

  test("rejects an encrypted field", () => {
    expect(() =>
      validateWith({
        n: related(
          { measure: { kind: "first", field: "secret", orderBy: "rank", direction: "asc" } },
          "text",
        ),
      }),
    ).toThrow(/"secret" is encrypted or secret/);
  });

  test("rejects label: true on a reference without labelField and on a plain field", () => {
    expect(() =>
      validateWith({
        n: related(
          {
            measure: {
              kind: "first",
              field: "plainRef",
              orderBy: "rank",
              direction: "asc",
              label: true,
            },
          },
          "text",
        ),
      }),
    ).toThrow(/label: true needs a reference field with a labelField/);
    expect(() =>
      validateWith({
        n: related(
          {
            measure: {
              kind: "first",
              field: "status",
              orderBy: "rank",
              direction: "asc",
              label: true,
            },
          },
          "text",
        ),
      }),
    ).toThrow(/label: true needs a reference field/);
  });

  test("rejects a valueType that does not fit the measure", () => {
    expect(() => validateWith({ n: related({}, "text") })).toThrow(/valueType must be "number"/);
    expect(() =>
      validateWith({
        n: related(
          { measure: { kind: "first", field: "startsOn", orderBy: "rank", direction: "asc" } },
          "text",
        ),
      }),
    ).toThrow(/valueType must be "date"/);
  });

  test("rejects activeOn on non-date fields", () => {
    expect(() =>
      validateWith({
        n: createDerivedField({
          valueType: "number",
          sql: {
            kind: "related",
            entity: "child",
            on: { field: "unitId" },
            measure: { kind: "count" },
            where: [{ activeOn: { from: "rank", to: "endsOn" } }],
          },
        }),
      }),
    ).toThrow(/activeOn field "rank" must be a date field/);
  });

  test("rejects coalesce over unknown fields, mixed types or a wrong valueType", () => {
    const coalesce = (fields: string[], valueType: "text" | "number" = "text") =>
      createDerivedField({ valueType, sql: { kind: "coalesce", fields } });
    expect(() => validateWith({ n: coalesce(["name", "nope"]) })).toThrow(
      /coalesce field "nope" is not a field/,
    );
    expect(() => validateWith({ n: coalesce(["name", "floor"]) })).toThrow(/same type/);
    expect(() => validateWith({ n: coalesce(["name", "nickname"], "number") })).toThrow(
      /valueType must be "text"/,
    );
  });

  test("rejects an entity deriving from itself", () => {
    expect(() => validateWith({ n: related({ entity: "unit", on: { field: "floor" } }) })).toThrow(
      /cannot derive from itself/,
    );
  });

  test("rejects sortable on a JS derive", () => {
    const jsWithSortable = {
      ...createDerivedField({ valueType: "text", derive: () => "x" }),
      sortable: true,
    };
    expect(() => validateWith({ n: jsWithSortable })).toThrow(/sortable needs a sql derived field/);
  });
});

describe("entityList defaultSort over derived fields", () => {
  const featureSortingBy = (field: string) =>
    defineFeature("demo", (r) => {
      r.entity({
        name: "item",
        ...createEntity({
          table: "Items",
          fields: { name: text(), nickname: text() },
          derivedFields: {
            shown: createDerivedField({
              valueType: "text",
              sortable: true,
              sql: { kind: "coalesce", fields: ["nickname", "name"] },
            }),
            plain: createDerivedField({ valueType: "text", derive: () => "x" }),
          },
        }),
      });
      r.screen({
        id: "item-list",
        type: "entityList",
        entity: "item",
        columns: ["name", "shown", "plain"],
        defaultSort: { field, dir: "asc" },
      });
      r.translations({
        keys: {
          "screen:item-list.title": { de: "Liste", en: "List" },
          "demo:entity:item:field:name": { de: "Name", en: "Name" },
          "demo:entity:item:field:shown": { de: "Anzeige", en: "Shown" },
          "demo:entity:item:field:plain": { de: "Plain", en: "Plain" },
        },
      });
    });

  test("a sortable SQL derived field is accepted as defaultSort", () => {
    expect(() =>
      validateBootRaw(withBootValidatorFixture([featureSortingBy("shown")])),
    ).not.toThrow();
  });

  test("a JS derived field is rejected as defaultSort", () => {
    expect(() => validateBootRaw(withBootValidatorFixture([featureSortingBy("plain")]))).toThrow(
      /defaultSort/,
    );
  });
});
