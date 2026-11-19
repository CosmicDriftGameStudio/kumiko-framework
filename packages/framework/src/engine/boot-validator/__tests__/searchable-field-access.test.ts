import { expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity } from "../../factories.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

function searchableFeatureWith(field: Record<string, unknown>): ReturnType<typeof defineFeature>[] {
  return [
    defineFeature("a", (r) => {
      r.entity(
        createEntity({
          name: "memo",
          table: "Memos",
          fields: {
            secret: {
              type: "text",
              allowPlaintext: "test fixture value, not personal data",
              personal: false,
              reason: "test_fixture",
              ...field,
            } as never, // @cast-boundary test builds field variants dynamically
          },
        }),
      );
    }),
  ];
}

test("rejects a searchable field with a restricted access.read", () => {
  expect(() =>
    validateBoot(searchableFeatureWith({ searchable: true, access: { read: ["Admin"] } })),
  ).toThrow(/secret.*cannot be searchable with a restricted access\.read/i);
});

function embeddedSearchableFeature(
  subField: Record<string, unknown>,
  parent: Record<string, unknown> = {},
) {
  return defineFeature("memos", (r) => {
    r.entity(
      createEntity({
        name: "memo",
        table: "Memos",
        fields: {
          note: {
            type: "embedded",
            schema: { body: { type: "text", searchable: true, ...subField } },
            ...parent,
          } as never, // @cast-boundary test builds embedded variants dynamically
        },
      }),
    );
  });
}

test("rejects a searchable embedded sub-field with a restricted access.read", () => {
  expect(() => validateBoot([embeddedSearchableFeature({ access: { read: ["Admin"] } })])).toThrow(
    /note\.body.*cannot be searchable with a restricted access\.read/i,
  );
});

test("rejects a searchable embedded sub-field under a parent with a restricted access.read", () => {
  expect(() =>
    validateBoot([embeddedSearchableFeature({}, { access: { read: ["Admin"] } })]),
  ).toThrow(/note\.body.*cannot be searchable with a restricted access\.read/i);
});

test("allows a searchable embedded sub-field without restricted access.read", () => {
  expect(() => validateBoot([embeddedSearchableFeature({})])).not.toThrow();
});

test("allows a searchable field without access.read or with an empty one", () => {
  expect(() => validateBoot(searchableFeatureWith({ searchable: true }))).not.toThrow();
  expect(() =>
    validateBoot(searchableFeatureWith({ searchable: true, access: { read: [] } })),
  ).not.toThrow();
});

test("rejects a fuzzy-searchable longText field with a restricted access.read", () => {
  expect(() =>
    validateBoot(
      searchableFeatureWith({ type: "longText", searchable: true, access: { read: ["Admin"] } }),
    ),
  ).toThrow(/secret.*cannot be searchable with a restricted access\.read/i);
});

test("allows a fuzzy-searchable longText field without access.read", () => {
  expect(() =>
    validateBoot(searchableFeatureWith({ type: "longText", searchable: true })),
  ).not.toThrow();
});

test("allows a restricted access.read on a non-searchable field", () => {
  expect(() => validateBoot(searchableFeatureWith({ access: { read: ["Admin"] } }))).not.toThrow();
});
