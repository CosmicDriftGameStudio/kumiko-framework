import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createComplianceProfilesFeature } from "../../compliance-profiles/feature";
import { createConfigFeature } from "../../config/feature";
import { createDataRetentionFeature } from "../../data-retention/feature";
import { createSessionsFeature } from "../../sessions/feature";
import { createUserFeature } from "../../user/feature";
import { createUserDataRightsFeature } from "../feature";

// Read-only GDPR inspector screens live IN user-data-rights (the boot-validator
// forbids cross-feature screen ownership). The validator checks screen structure
// — entity-local binding, columns/fields exist on the entity, rowAction targets
// resolve — so a clean boot proves the entityList/entityEdit defs bind to the
// real event-sourced entities and the convention list/detail QNs exist. The
// entities (export-job, download-attempt) are r.entity, not direct-write stores,
// so an entityList binding is rebuild-safe (unlike jobs/sessions read-models).

describe("user-data-rights read-only inspector screens", () => {
  const features = [
    createConfigFeature(),
    createUserFeature(),
    createSessionsFeature(),
    createDataRetentionFeature(),
    createComplianceProfilesFeature(),
    createUserDataRightsFeature(),
  ];

  test("the assembled feature set boot-validates", () => {
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("ships SystemAdmin-gated list + detail screens", () => {
    const f = createUserDataRightsFeature();
    expect(Object.keys(f.screens)).toEqual(
      expect.arrayContaining(["export-job-list", "export-job-detail", "download-attempt-list"]),
    );
    const list = f.screens["export-job-list"];
    expect(list?.type).toBe("entityList");
    expect(list?.access).toEqual({ roles: ["SystemAdmin"] });
  });

  test("export-job detail is strictly read-only (no create/delete, every field readOnly)", () => {
    const f = createUserDataRightsFeature();
    const edit = f.screens["export-job-detail"];
    expect(edit?.type).toBe("entityEdit");
    if (edit?.type === "entityEdit") {
      expect(edit.allowCreate).toBe(false);
      expect(edit.allowDelete).toBe(false);
      const fields = edit.layout.sections.flatMap((s) => ("fields" in s ? s.fields : []));
      expect(fields.length).toBeGreaterThan(0);
      expect(fields.every((field) => typeof field === "object" && field.readOnly === true)).toBe(
        true,
      );
    }
  });

  test("convention list/detail handlers resolve the screen QNs", () => {
    const f = createUserDataRightsFeature();
    // entityList → user-data-rights:query:export-job:list; entityEdit detail →
    // :export-job:detail; download-attempt list → :download-attempt:list.
    expect(Object.keys(f.queryHandlers)).toEqual(
      expect.arrayContaining(["export-job:list", "export-job:detail", "download-attempt:list"]),
    );
  });
});
