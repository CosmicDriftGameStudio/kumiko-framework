import { describe, expect, test } from "bun:test";
import type { EntityListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Translate } from "../../headless/index.ts";
import { resolveItemNoun } from "../render-list-toolbar-model.ts";

const NOUNS: Readonly<Record<string, string>> = {
  "shop:noun:order": "orders",
  "shop:noun:prop": "contracts",
};
const translate: Translate = (key) => NOUNS[key] ?? key;

const projectionScreen: EntityListScreenDefinition = {
  id: "orders",
  type: "entityList",
  entity: "__projection__",
  columns: ["number"],
  itemNounKey: "shop:noun:order",
};

const labelInput = {
  translate,
  createLabel: undefined,
  searchPlaceholder: undefined,
  featureName: "shop",
};

describe("resolveItemNoun", () => {
  test("a projection screen's itemNounKey yields the noun", () => {
    const noun = resolveItemNoun({
      ...labelInput,
      screen: projectionScreen,
      itemNounKey: undefined,
    });
    expect(noun?.(2)).toBe("orders");
  });

  test("the itemNounKey input wins over the screen's", () => {
    const noun = resolveItemNoun({
      ...labelInput,
      screen: projectionScreen,
      itemNounKey: "shop:noun:prop",
    });
    expect(noun?.(2)).toBe("contracts");
  });
});
