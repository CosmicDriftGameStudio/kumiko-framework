import { expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createDerivedField, createEntity, createTextField } from "../../factories.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

test("rejects longText field in entity.indexes (longText is not indexable)", () => {
  // Prevents a BTREE index from being built on a 1-MB text column, which could
  // cause severe performance problems when dereferencing TOAST pages. `longText`
  // is semantically non-indexable, consistent with the type-level `sortable=false`.
  const features = [
    defineFeature("a", (r) => {
      r.entity(
        createEntity({
          name: "doc",
          table: "Docs",
          fields: {
            body: { type: "longText", allowPlaintext: "test fixture value, not personal data" },
            title: { type: "text", allowPlaintext: "test fixture value, not personal data" },
          },
          indexes: [{ columns: ["title", "body"] }],
        }),
      );
    }),
  ];
  expect(() => validateBoot(features)).toThrow(/body.*longText.*cannot be indexed/i);
});

test("throws when extendSchema column conflicts with existing field", () => {
  const features = [
    defineFeature("a", (r) => {
      r.entity(
        createEntity({
          name: "item",
          table: "Items",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.extendsRegistrar("custom", {
        extendSchema: () => ({
          name: {
            type: "text" as const,
            allowPlaintext: "test fixture value, not personal data",
          },
        }),
      });
    }),
  ];
  expect(() => validateBoot(features)).toThrow(
    /extendSchema column "name" conflicts.*entity "item"/i,
  );
});

test("throws when a derivedFields key conflicts with a stored field", () => {
  const features = [
    defineFeature("a", (r) => {
      r.entity(
        createEntity({
          name: "item",
          table: "Items",
          fields: { status: createTextField({ personal: false, reason: "test_fixture" }) },
          derivedFields: {
            status: createDerivedField({ valueType: "text", derive: () => "computed" }),
          },
        }),
      );
    }),
  ];
  expect(() => validateBoot(features)).toThrow(
    /entity "item".*derivedFields key "status".*conflicts/i,
  );
});

test("passes when derivedFields keys don't conflict with stored fields", () => {
  const features = [
    defineFeature("a", (r) => {
      r.entity(
        createEntity({
          name: "item",
          table: "Items",
          fields: { status: createTextField({ personal: false, reason: "test_fixture" }) },
          derivedFields: {
            statusLabel: createDerivedField({ valueType: "text", derive: () => "computed" }),
          },
        }),
      );
    }),
  ];
  expect(() => validateBoot(features)).not.toThrow();
});

test("passes when extendSchema adds non-conflicting column", () => {
  const features = [
    defineFeature("a", (r) => {
      r.entity(
        createEntity({
          name: "item",
          table: "Items",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.extendsRegistrar("custom", {
        extendSchema: () => ({
          extra: {
            type: "text" as const,
            allowPlaintext: "test fixture value, not personal data",
          },
        }),
      });
    }),
  ];
  expect(() => validateBoot(features)).not.toThrow();
});
