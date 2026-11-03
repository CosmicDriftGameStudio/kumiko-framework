import { describe, expect, test } from "bun:test";
import { validateSortNulls } from "../boot-validator/sort-nulls.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createTimestampField } from "../factories.ts";

function featureWith(field: ReturnType<typeof createTimestampField>) {
  return defineFeature("leads", (r) => {
    r.entity({ name: "lead", ...createEntity({ table: "leads", fields: { receivedAt: field } }) });
  });
}

describe("validateSortNulls", () => {
  test("sortNulls without sortable throws", () => {
    expect(() =>
      validateSortNulls(featureWith(createTimestampField({ sortNulls: "last" }))),
    ).toThrow(/receivedAt.*sortNulls without sortable: true/);
  });

  test("sortNulls on a sortable field passes", () => {
    expect(() =>
      validateSortNulls(featureWith(createTimestampField({ sortable: true, sortNulls: "last" }))),
    ).not.toThrow();
  });

  test("a field without sortNulls passes", () => {
    expect(() => validateSortNulls(featureWith(createTimestampField()))).not.toThrow();
  });
});
