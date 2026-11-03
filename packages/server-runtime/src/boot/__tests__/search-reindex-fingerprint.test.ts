import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import type { SearchPayloadContributorFn } from "@cosmicdrift/kumiko-types/hooks";
import { searchReindexFingerprint } from "../search-reindex-on-boot";

function registryWith(contributor?: SearchPayloadContributorFn) {
  const feature = defineFeature("fingerprint", (r) => {
    const thing = r.entity({
      name: "thing",
      ...createEntity({
        table: "fingerprint_things",
        fields: {
          title: createTextField({
            personal: false,
            reason: "test_fixture",
            searchable: true,
          }),
        },
      }),
    });
    if (contributor) r.searchPayloadExtension(thing, contributor);
  });
  return createRegistry([feature]);
}

describe("searchReindexFingerprint", () => {
  test("is stable for the same fields and extension code", () => {
    expect(
      searchReindexFingerprint(
        registryWith(() => ({ a: 1 })),
        "thing",
      ),
    ).toBe(
      searchReindexFingerprint(
        registryWith(() => ({ a: 1 })),
        "thing",
      ),
    );
  });

  test("changes when an extension is replaced by different code, count unchanged", () => {
    expect(
      searchReindexFingerprint(
        registryWith(() => ({ a: 1 })),
        "thing",
      ),
    ).not.toBe(
      searchReindexFingerprint(
        registryWith(() => ({ b: 2 })),
        "thing",
      ),
    );
  });

  test("changes when an extension is added", () => {
    expect(searchReindexFingerprint(registryWith(), "thing")).not.toBe(
      searchReindexFingerprint(
        registryWith(() => ({ a: 1 })),
        "thing",
      ),
    );
  });
});
