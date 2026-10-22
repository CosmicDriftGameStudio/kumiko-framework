import { describe, expect, test } from "bun:test";
import {
  collectCardMetaOverflow,
  createDerivedField,
  createEntity,
  createSelectField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import type { ListColumnSpec } from "@cosmicdrift/kumiko-framework/ui-types";
import { CARD_META_MAX, cardColumnRoles } from "@cosmicdrift/kumiko-framework/ui-types";
import { computeListViewModel } from "../list.ts";

const text = () => createTextField({ personal: false, reason: "test_fixture" });
const entity = createEntity({
  fields: {
    name: text(),
    a: text(),
    b: text(),
    state: createSelectField({ options: ["open", "done"], required: true }),
    customerRef: text(),
  },
  derivedFields: {
    age: createDerivedField({ valueType: "number", derive: () => 0 }),
  },
});

// The boot validator re-implements the list view model's column type resolution; these
// fixtures keep both counting the same meta columns when either side changes.
const columnSets: readonly (readonly ListColumnSpec[])[] = [
  ["name", "state", "a", "b", "age", "modifiedAt"],
  ["name", "a", "b", "age", "modifiedAt", "version"],
  ["state", "name", "a", "b", "version", "insertedAt"],
  [
    "name",
    { field: "customerRef", refEntity: "customers:customer" },
    "a",
    "b",
    "insertedAt",
    "age",
  ],
  ["name", "a", "b", "age"],
];

describe("card meta overflow parity with computeListViewModel", () => {
  for (const columns of columnSets) {
    test(`columns ${JSON.stringify(columns)}`, () => {
      const feature = defineFeature("cards", (r) => {
        r.entity({ name: "item", ...entity });
        r.screen({ id: "item-list", type: "entityList", entity: "item", columns });
      });
      const view = computeListViewModel({
        screen: { id: "item-list", type: "entityList", entity: "item", columns },
        entity,
        rows: [],
        translate: (key) => key,
        featureName: "cards",
      });
      const { meta } = cardColumnRoles(
        view.columns.map((col) => ({
          field: col.field,
          type: col.type,
          renderer: col.renderer,
          hideOnNarrow: col.hideOnNarrow,
          fileDisplay: col.fileDisplay,
        })),
      );
      const overflow = collectCardMetaOverflow([feature])[0];
      expect(overflow?.fields).toEqual(
        meta.length > CARD_META_MAX ? meta.map((col) => col.field) : undefined,
      );
      expect(overflow === undefined).toBe(meta.length <= CARD_META_MAX);
    });
  }
});
