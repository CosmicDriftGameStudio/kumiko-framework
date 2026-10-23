import { describe, expect, test } from "bun:test";
import { imageLabelSource, snapshotOf, textVariablesOf } from "../pdf-editor-draft.ts";
import { EMPTY_PDF_META } from "../pdf-meta.ts";
import type { VariableInfo } from "../types.ts";

const variables: Readonly<Record<string, VariableInfo>> = {
  customer: { type: "text", label: "Customer", required: true },
  photos: { type: "images", label: "Photos" },
  unlabelled: { type: "images" },
  items: {
    type: "list",
    label: "Items",
    item: { sku: { type: "text", label: "SKU" }, photo: { type: "images" } },
  },
};

describe("imageLabelSource", () => {
  test("keeps only labelled images variables, typed as text", () => {
    expect(imageLabelSource(variables)).toEqual({ photos: { type: "text", label: "Photos" } });
  });
});

describe("textVariablesOf", () => {
  test("drops images variables and images columns of a list", () => {
    const result = textVariablesOf(variables);
    expect(Object.keys(result)).toEqual(["customer", "items"]);
    expect(result["items"]?.item).toEqual({ sku: { type: "text", label: "SKU" } });
  });

  test("leaves variables without columns free of an item entry", () => {
    const result = textVariablesOf(variables);
    expect(result["customer"]).toEqual({ type: "text", label: "Customer", required: true });
    expect("item" in (result["customer"] ?? {})).toBe(false);
  });
});

describe("snapshotOf", () => {
  test("changes when the content or the meta changes", () => {
    const base = { content: "<p>a</p>", meta: EMPTY_PDF_META };
    expect(snapshotOf(base)).toBe(snapshotOf({ ...base }));
    expect(snapshotOf(base)).not.toBe(snapshotOf({ ...base, content: "<p>b</p>" }));
  });
});
