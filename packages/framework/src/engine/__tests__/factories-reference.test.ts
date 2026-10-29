import { describe, expect, test } from "bun:test";
import { validateBoot } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createReferenceField, createTextField } from "../factories.ts";

describe("createReferenceField", () => {
  test("a plain reference carries no PII flags and defaults to optional", () => {
    expect(createReferenceField({ entity: "team" })).toEqual({
      type: "reference",
      entity: "team",
      required: false,
    });
  });

  test("keeps reference options and an explicit personal stance", () => {
    expect(
      createReferenceField({
        entity: "member",
        personal: "ref",
        labelField: "name",
        multiple: true,
        required: true,
      }),
    ).toEqual({
      type: "reference",
      entity: "member",
      labelField: "name",
      multiple: true,
      required: true,
      subjectRef: true,
    });
  });

  test("personal: false resolves to allowPlaintext for a non-user target", () => {
    expect(
      createReferenceField({ entity: "team", personal: false, reason: "is_system_identifier" }),
    ).toMatchObject({ allowPlaintext: "is_system_identifier" });
  });

  test.each(["user", "user:user"])("a reference to %s defaults to personal: ref", (entity) => {
    expect(createReferenceField({ entity })).toMatchObject({ subjectRef: true });
  });

  test("personal: false on a user reference throws", () => {
    expect(() =>
      createReferenceField({ entity: "user:user", personal: false, reason: "is_business_data" }),
    ).toThrow(/not allowed for a reference to the user entity/);
  });
});

describe("validateBoot — plaintext user reference", () => {
  const named = createEntity({
    fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
  });
  const access = { roles: ["Admin"] };

  const targets = defineFeature("user", (r) => {
    r.crud("user", named, { write: { access }, read: { access } });
  });

  function featureWith(field: ReturnType<typeof createReferenceField>) {
    return defineFeature("test", (r) => {
      r.requires({ features: ["user"] });
      r.crud("team", named, { write: { access }, read: { access } });
      r.entity({ name: "note", ...createEntity({ fields: { approvedBy: field } }) });
    });
  }

  test("a hand-built reference to the user entity with allowPlaintext fails boot", () => {
    const feature = featureWith({
      type: "reference",
      entity: "user:user",
      required: false,
      allowPlaintext: "is_business_data",
    });
    expect(() => validateBoot([targets, feature])).toThrow(/personal: "ref"/);
  });

  test("the factory's user reference boots", () => {
    const feature = featureWith(createReferenceField({ entity: "user:user" }));
    expect(() => validateBoot([targets, feature])).not.toThrow();
  });

  test("a plaintext reference to another entity boots", () => {
    const feature = featureWith(
      createReferenceField({ entity: "team", personal: false, reason: "is_system_identifier" }),
    );
    expect(() => validateBoot([targets, feature])).not.toThrow();
  });
});
