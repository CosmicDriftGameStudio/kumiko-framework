// A recordOwned field is encrypted under `record:<entity>:<id>`
// (kms-adapter-types.ts) and forgetSubject's subjectIdSchema (crypto/kms-adapter.ts)
// validates that id as a UUID. An idType: "serial" entity would encrypt such
// a field but could never satisfy a forget-subject request for it — the boot
// guard catches that combination before it ships.

import { describe, expect, test } from "bun:test";
import type { FieldsMap } from "@cosmicdrift/kumiko-types/fields";
import { plaintextText } from "../../__tests__/plaintext-fields.ts";
import { validateBoot } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";
import type { FeatureDefinition } from "../../types/index.ts";
import {
  validateForgetWithSubject,
  validateRecordKeyHeldByOneOwner,
  validateRecordOwnedSubjects,
} from "../record-owned.ts";

// Presence/absence of the annotation is the test variable here; the factory
// cannot produce the unannotated shape.

function featureWith(
  idType: "serial" | "uuid" | undefined,
  withRecordOwnedField: boolean,
): FeatureDefinition {
  return defineFeature("notes", (r) => {
    r.entity(
      createEntity({
        name: "note",
        table: "fw2809_guard_notes",
        idType,
        fields: {
          body: withRecordOwnedField
            ? createTextField({ personal: { of: "id" }, find: "none" })
            : plaintextText,
        },
      }),
    );
  });
}

describe("validateRecordOwnedSubjects", () => {
  test("idType: 'serial' + recordOwned field fails the boot, naming entity and field", () => {
    const feature = featureWith("serial", true);
    expect(() => validateRecordOwnedSubjects(feature)).toThrow(/Feature notes/);
    expect(() => validateRecordOwnedSubjects(feature)).toThrow(/"note"/);
    expect(() => validateRecordOwnedSubjects(feature)).toThrow(/"body"/);
  });

  test("idType: 'uuid' + recordOwned field boots fine", () => {
    const feature = featureWith("uuid", true);
    expect(() => validateRecordOwnedSubjects(feature)).not.toThrow();
  });

  test("idType omitted (default uuid) + recordOwned field boots fine", () => {
    const feature = featureWith(undefined, true);
    expect(() => validateRecordOwnedSubjects(feature)).not.toThrow();
  });

  test("idType: 'serial' without any recordOwned field boots fine", () => {
    const feature = featureWith("serial", false);
    expect(() => validateRecordOwnedSubjects(feature)).not.toThrow();
  });
});

describe("validateForgetWithSubject", () => {
  type EmailStance = "none" | "self" | "record";

  function forgetFeature(
    stance: EmailStance,
    retention?: { keepFor: string; strategy: "blockDelete" },
  ): FeatureDefinition {
    const email =
      stance === "self"
        ? createTextField({ personal: "self", find: "none" })
        : stance === "record"
          ? createTextField({ personal: { of: "id" }, find: "none" })
          : plaintextText;
    return defineFeature("subscribers", (r) => {
      r.entity(
        createEntity({
          table: "forget_with_subject_subscribers",
          forgetWithSubject: true,
          ...(retention && { retention }),
          fields: { email },
          name: "subscriber",
        }),
      );
    });
  }

  test("an entity without any subject field fails the boot, naming the entity", () => {
    const feature = forgetFeature("none");
    expect(() => validateForgetWithSubject(feature)).toThrow(
      /forget-with-subject|forgetWithSubject/,
    );
    expect(() => validateForgetWithSubject(feature)).toThrow(/"subscriber"/);
  });

  test("retention blockDelete fails the boot", () => {
    const feature = forgetFeature("self", { keepFor: "10y", strategy: "blockDelete" });
    expect(() => validateForgetWithSubject(feature)).toThrow(/blockDelete/);
  });

  test("a personal: 'self' field boots fine", () => {
    expect(() => validateForgetWithSubject(forgetFeature("self"))).not.toThrow();
  });

  test("a personal: { of: 'id' } field boots fine", () => {
    expect(() => validateForgetWithSubject(forgetFeature("record"))).not.toThrow();
  });
});

describe("validateRecordKeyHeldByOneOwner", () => {
  function selfKeyedFeature(fields: FieldsMap): FeatureDefinition {
    return defineFeature("slips", (r) =>
      r.entity(createEntity({ name: "slip", table: "record_key_one_owner_slips", fields })),
    );
  }

  const ref = () => createTextField({ personal: "ref" });
  const withRecordOwned = () =>
    selfKeyedFeature({
      ownerId: ref(),
      name: createTextField({ personal: { of: "ownerId", whenAbsent: "self" }, find: "none" }),
      body: createTextField({ personal: { of: "id" }, find: "none" }),
    });

  test("a whenAbsent self field next to a recordOwned field fails the boot", () => {
    const feature = withRecordOwned();
    expect(() => validateRecordKeyHeldByOneOwner(feature)).toThrow(/"slip"/);
    expect(() => validateRecordKeyHeldByOneOwner(feature)).toThrow(/"body"/);
    expect(() => validateRecordKeyHeldByOneOwner(feature)).toThrow(/recordOwned/);
  });

  test("whenAbsent self fields of two owner fields fail the boot", () => {
    const feature = selfKeyedFeature({
      ownerId: ref(),
      reviewerId: ref(),
      name: createTextField({ personal: { of: "ownerId", whenAbsent: "self" }, find: "none" }),
      verdict: createTextField({
        personal: { of: "reviewerId", whenAbsent: "self" },
        find: "none",
      }),
    });
    expect(() => validateRecordKeyHeldByOneOwner(feature)).toThrow(/"ownerId"/);
    expect(() => validateRecordKeyHeldByOneOwner(feature)).toThrow(/"reviewerId"/);
  });

  test("several whenAbsent self fields of one owner boot fine", () => {
    const feature = selfKeyedFeature({
      ownerId: ref(),
      reviewerId: ref(),
      name: createTextField({ personal: { of: "ownerId", whenAbsent: "self" }, find: "none" }),
      code: createTextField({ personal: { of: "ownerId", whenAbsent: "self" }, find: "none" }),
      note: createTextField({ personal: { of: "reviewerId", whenAbsent: "tenant" }, find: "none" }),
      label: createTextField({ personal: "self", find: "none" }),
    });
    expect(() => validateRecordKeyHeldByOneOwner(feature)).not.toThrow();
  });

  test("validateBoot runs the rule", () => {
    expect(() => validateBoot([withRecordOwned()])).toThrow(/recordOwned/);
  });
});
