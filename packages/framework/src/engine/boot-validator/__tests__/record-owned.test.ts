// fw#2809 — a recordOwned field is encrypted under `record:<entity>:<id>`
// (kms-adapter-types.ts) and forgetSubject's subjectIdSchema (crypto/kms-adapter.ts)
// validates that id as a UUID. An idType: "serial" entity would encrypt such
// a field but could never satisfy a forget-subject request for it — the boot
// guard catches that combination before it ships.

import { describe, expect, test } from "bun:test";
import { defineFeature } from "../../define-feature";
import { createEntity, createTextField } from "../../factories";
import type { FeatureDefinition } from "../../types";
import { validateRecordOwnedSubjects } from "../record-owned";

function featureWith(
  idType: "serial" | "uuid" | undefined,
  withRecordOwnedField: boolean,
): FeatureDefinition {
  return defineFeature("notes", (r) => {
    r.entity(
      "note",
      createEntity({
        table: "fw2809_guard_notes",
        idType,
        fields: {
          body: withRecordOwnedField
            ? createTextField({ personal: { of: "id" }, find: "none" })
            : createTextField(),
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
