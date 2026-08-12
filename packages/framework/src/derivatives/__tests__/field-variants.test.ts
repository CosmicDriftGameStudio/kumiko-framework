import { describe, expect, test } from "bun:test";
import type { VariantSpec } from "@cosmicdrift/kumiko-types/derivatives-types";
import type { EntityDefinition, FieldDefinition, Registry } from "../../engine/types";
import { resolveFieldVariant } from "../field-variants";

// Minimal fake Registry — same pattern as derivatives-context.test.ts's
// fakeRegistry: only getEntity is exercised by resolveFieldVariant.
function fakeRegistry(entities: Readonly<Record<string, EntityDefinition>>): Registry {
  const map = new Map(Object.entries(entities));
  return {
    getEntity: (name: string) => map.get(name),
  } as unknown as Registry;
}

const THUMB_SPEC: VariantSpec = { maxEdge: 200, format: "webp" };

function photoEntityWith(field: FieldDefinition): Readonly<Record<string, EntityDefinition>> {
  return {
    photo: { fields: { avatar: field } },
  };
}

describe("resolveFieldVariant", () => {
  test("returns the declared spec for a known variant name", () => {
    const registry = fakeRegistry(
      photoEntityWith({ type: "image", variants: { thumb: THUMB_SPEC } }),
    );
    expect(resolveFieldVariant(registry, "photo", "avatar", "thumb")).toBe(THUMB_SPEC);
  });

  test("unknown variant name returns undefined", () => {
    const registry = fakeRegistry(
      photoEntityWith({ type: "image", variants: { thumb: THUMB_SPEC } }),
    );
    expect(resolveFieldVariant(registry, "photo", "avatar", "nope")).toBeUndefined();
  });

  test("__proto__ as a name returns undefined — the prototype-pollution case Object.hasOwn catches", () => {
    const registry = fakeRegistry(
      photoEntityWith({ type: "image", variants: { thumb: THUMB_SPEC } }),
    );
    expect(resolveFieldVariant(registry, "photo", "avatar", "__proto__")).toBeUndefined();
  });

  test("null entityType or fieldName returns undefined", () => {
    const registry = fakeRegistry(
      photoEntityWith({ type: "image", variants: { thumb: THUMB_SPEC } }),
    );
    expect(resolveFieldVariant(registry, null, "avatar", "thumb")).toBeUndefined();
    expect(resolveFieldVariant(registry, "photo", null, "thumb")).toBeUndefined();
  });

  test("a non-image field returns undefined even when its own value looks variant-shaped", () => {
    const registry = fakeRegistry(photoEntityWith({ type: "text" }));
    expect(resolveFieldVariant(registry, "photo", "avatar", "thumb")).toBeUndefined();
  });

  test("an image field without variants returns undefined", () => {
    const registry = fakeRegistry(photoEntityWith({ type: "image" }));
    expect(resolveFieldVariant(registry, "photo", "avatar", "thumb")).toBeUndefined();
  });
});
