import { describe, expect, test } from "bun:test";
import { plaintextText } from "../../__tests__/plaintext-fields.ts";
import { validateBoot } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";
import { BootRuleViolation, BootValidationError, type BootViolation } from "../boot-rule.ts";
import { validateCardMetaOverflow } from "../card-meta-overflow.ts";
import { validateActionHasIcon } from "../screens.ts";

function violationsOf(fn: () => void): readonly BootViolation[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof BootValidationError) return e.violations;
    throw e;
  }
  throw new Error("expected BootValidationError");
}

function ruleIdsOf(fn: () => void): readonly string[] {
  return violationsOf(fn).map((v) => v.ruleId);
}

function thrownBy(fn: () => void): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected function to throw");
}

const text = () => createTextField({ personal: false, reason: "test_fixture" });

describe("pii rules", () => {
  const featureWith = (fields: Record<string, ReturnType<typeof text>>) =>
    defineFeature("demo", (r) => {
      r.entity({ name: "vault", ...createEntity({ table: "Vaults", fields }) });
    });

  test("a classified rule id and its fix reach the violation", () => {
    const feature = featureWith({
      token: createTextField({ personal: "self", sortable: true, find: "none" }),
    });
    const violations = violationsOf(() => validateBoot([feature]));
    const violation = violations.find((v) => v.ruleId === "pii/subject-key-sortable");
    expect(violation?.fix).toBeString();
    expect(violation?.message).toContain("combines a subject-key annotation");
  });

  test("two different rules on one field are both reported", () => {
    const feature = defineFeature("demo", (r) => {
      r.entity({
        name: "vault",
        ...createEntity({
          table: "Vaults",
          fields: { token: { ...plaintextText, sensitive: true, lookupable: true } },
        }),
      });
    });
    const ruleIds = ruleIdsOf(() => validateBoot([feature]));
    expect(ruleIds).toContain("pii/sensitive-without-ciphertext");
    expect(ruleIds).toContain("pii/lookupable-without-subject");
  });

  test("violations on two fields of one entity are both reported", () => {
    const feature = featureWith({
      a: createTextField({ personal: "self", sortable: true, find: "none" }),
      b: createTextField({ personal: "self", sortable: true, find: "none" }),
    });
    const ruleIds = ruleIdsOf(() => validateBoot([feature]));
    expect(ruleIds.filter((id) => id === "pii/subject-key-sortable")).toHaveLength(2);
  });
});

describe("entity-list rules", () => {
  test("searchable:false without defaultSort on a filterable field reports both rules", () => {
    const feature = defineFeature("demo", (r) => {
      r.entity({
        name: "item",
        ...createEntity({
          table: "Items",
          fields: {
            name: createTextField({ filterable: true, personal: false, reason: "test_fixture" }),
          },
        }),
      });
      r.screen({
        id: "item-list",
        type: "entityList",
        entity: "item",
        columns: ["name"],
        searchable: false,
      });
      r.translations({
        keys: {
          "screen:item-list.title": { de: "Liste", en: "List" },
          "demo:entity:item:field:name": { de: "Name", en: "Name" },
        },
      });
    });
    const ruleIds = ruleIdsOf(() => validateBoot([feature]));
    expect(ruleIds).toContain("entity-list/searchable-false");
    expect(ruleIds).toContain("entity-list/default-sort-required");
  });

  test("unknown columns are collected per column", () => {
    const feature = defineFeature("demo", (r) => {
      r.entity({ name: "item", ...createEntity({ table: "Items", fields: { name: text() } }) });
      r.screen({
        id: "item-list",
        type: "entityList",
        entity: "item",
        columns: ["name", "ghost-one", "ghost-two"],
        defaultSort: { field: "name", dir: "asc" },
      });
    });
    const ruleIds = ruleIdsOf(() => validateBoot([feature]));
    expect(ruleIds.filter((id) => id === "entity-list/unknown-column")).toHaveLength(2);
  });
});

describe("i18n rules", () => {
  test("two missing keys give two violations", () => {
    const feature = defineFeature("demo", (r) => {
      r.entity({ name: "item", ...createEntity({ table: "Items", fields: { name: text() } }) });
      r.screen({
        id: "item-list",
        type: "entityList",
        entity: "item",
        columns: ["name"],
        defaultSort: { field: "name", dir: "asc" },
      });
    });
    const missing = violationsOf(() => validateBoot([feature])).filter(
      (v) => v.ruleId === "i18n/missing-feature-key",
    );
    expect(missing.length).toBeGreaterThanOrEqual(2);
    expect(new Set(missing.map((v) => v.message)).size).toBe(missing.length);
  });
});

describe("api and extension rules", () => {
  test("two unknown API usages in one feature are both reported", () => {
    const feature = defineFeature("demo", (r) => {
      r.usesApi("ghost.one");
      r.usesApi("ghost.two");
    });
    expect(ruleIdsOf(() => validateBoot([feature]))).toEqual([
      "api/unknown-api",
      "api/unknown-api",
    ]);
  });

  test("an API exposed by a feature that is not required is classified", () => {
    const provider = defineFeature("provider", (r) => {
      r.exposesApi("shared.api");
    });
    const consumer = defineFeature("consumer", (r) => {
      r.usesApi("shared.api");
    });
    expect(ruleIdsOf(() => validateBoot([provider, consumer]))).toEqual([
      "api/provider-not-required",
    ]);
  });

  test("an unknown extension usage is classified", () => {
    const feature = defineFeature("demo", (r) => {
      r.entity({ name: "item", ...createEntity({ table: "Items", fields: { name: text() } }) });
      r.useExtension("ghost-extension", "item", {});
    });
    expect(ruleIdsOf(() => validateBoot([feature]))).toContain("extension/unknown-extension");
  });
});

describe("list and action rules", () => {
  test("card meta overflow is one classified violation", () => {
    const feature = defineFeature("cards", (r) => {
      r.entity({
        name: "item",
        ...createEntity({
          fields: { name: text(), a: text(), b: text(), c: text(), d: text() },
        }),
      });
      r.screen({
        id: "item-list",
        type: "entityList",
        entity: "item",
        columns: ["name", "a", "b", "c", "d"],
      });
    });
    const error = thrownBy(() => validateCardMetaOverflow([feature]));
    expect(error).toBeInstanceOf(BootRuleViolation);
    expect(error instanceof BootRuleViolation && error.rule.id).toBe("list/card-meta-overflow");
  });

  test("an action without a resolvable icon is classified", () => {
    const error = thrownBy(() =>
      validateActionHasIcon("orders", "order-detail", "projectionDetail", "action", {
        id: "custom-thing",
      }),
    );
    expect(error instanceof BootRuleViolation && error.rule.id).toBe("screen/action-icon");
  });
});
