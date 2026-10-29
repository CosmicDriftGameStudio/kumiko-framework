import { describe, expect, test } from "bun:test";
import { createDocumentsFeature } from "../feature.ts";

const optionKey = (category: string) =>
  `documents:entity:filed-document:field:category:option:${category}`;

function featureWith(categoryLabels: Record<string, { de: string; en: string }>) {
  return createDocumentsFeature({
    categories: ["contract", "id"],
    linkTargets: ["property"],
    categoryLabels,
  });
}

describe("categoryLabels", () => {
  test("a labelled category shows its label, an unlabelled one its raw value", () => {
    const { translations } = featureWith({ contract: { de: "Vertrag", en: "Contract" } });
    expect(translations?.[optionKey("contract")]).toEqual({ de: "Vertrag", en: "Contract" });
    expect(translations?.[optionKey("id")]).toEqual({ de: "id", en: "id" });
  });

  test("a label for a category that does not exist throws", () => {
    expect(() => featureWith({ unknown: { de: "x", en: "x" } })).toThrow(
      'names "unknown", which is not in categories',
    );
  });
});
