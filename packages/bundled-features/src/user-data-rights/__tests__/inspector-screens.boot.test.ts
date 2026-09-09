import { describe, expect, test } from "bun:test";
import { access, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createFilesFeature } from "@cosmicdrift/kumiko-framework/files";
import { authFoundationFeature } from "../../auth-foundation";
import { createComplianceProfilesFeature } from "../../compliance-profiles/feature";
import { createConfigFeature } from "../../config/feature";
import { createDataRetentionFeature } from "../../data-retention/feature";
import { createPersonalAccessTokensFeature } from "../../personal-access-tokens";
import { createSessionsFeature } from "../../sessions/feature";
import { createTenantFeature } from "../../tenant/feature";
import { createUserFeature } from "../../user/feature";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults/feature";
import { createUserDataRightsFeature } from "../feature";

// Read-only GDPR inspector screens live IN user-data-rights (the boot-validator
// forbids cross-feature screen ownership). The validator checks screen structure
// — entity-local binding, columns/fields exist on the entity, rowAction targets
// resolve — so a clean boot proves the entityList/entityEdit defs bind to the
// real event-sourced entities and the convention list/detail QNs exist. The
// entities (export-job, download-attempt) are r.entity, not direct-write stores,
// so an entityList binding is rebuild-safe (unlike jobs/sessions read-models).

describe("user-data-rights read-only inspector screens", () => {
  // A realistic assembly: mounting user-data-rights without its default hooks
  // now fails the V3 boot gate (the framework `user` entity holds PII with no
  // erase path). Real apps mount the defaults (which hard-require `files`)
  // alongside — so this set mirrors that.
  const features = [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
    authFoundationFeature,
    createPersonalAccessTokensFeature({ scopes: {} }),
    createSessionsFeature(),
    createDataRetentionFeature(),
    createComplianceProfilesFeature(),
    createFilesFeature(),
    createUserDataRightsFeature(),
    createUserDataRightsDefaultsFeature(),
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
    expect(list?.access).toEqual({ roles: access.systemAdmin });
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

// fw#2312 — privacy-center converted from a custom screen to a declarative
// projectionDetail (Restriction/Deletion fields+actions, Export stays a
// custom extension section). `validateBoot` above already proves the
// screen clears every boot-validator rule for projectionDetail extension
// sections (entityName set, contributesToFormSubmit not true) — these
// tests pin the GDPR-relevant shape the type system can't check itself:
// which handler each action dispatches, the confirm-dialog description,
// and the visibility conditions carried over from the pre-#2312 custom
// screen (restrict.tsx/deletion.tsx RestrictionSection/DeletionSection).
describe("privacy-center screen (fw#2312 projectionDetail conversion)", () => {
  test("is a projectionDetail bound to the user's own `me` query", () => {
    const f = createUserDataRightsFeature();
    const screen = f.screens["privacy-center"];
    expect(screen?.type).toBe("projectionDetail");
    if (screen?.type === "projectionDetail") {
      expect(screen.query).toBe("user:query:user:me");
      expect(screen.access).toEqual({ openToAll: true });
    }
  });

  test("Export section is a self-persisting extension scoped to export-job", () => {
    const f = createUserDataRightsFeature();
    const screen = f.screens["privacy-center"];
    if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    const exportSection = screen.layout.sections.find((s) => s.kind === "extension");
    expect(exportSection?.entityName).toBe("export-job");
    expect(exportSection?.contributesToFormSubmit).not.toBe(true);
  });

  test("`status` renders exactly once across the screen, with a translated enum label", () => {
    const f = createUserDataRightsFeature();
    const screen = f.screens["privacy-center"];
    if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    const statusFields = screen.layout.sections
      .flatMap((s) => ("fields" in s ? s.fields : []))
      .filter((field) =>
        typeof field === "string" ? field === "status" : field.field === "status",
      );
    expect(statusFields).toHaveLength(1);
    const statusField = statusFields[0];
    expect(typeof statusField === "object" ? statusField.renderer : undefined).toEqual({
      format: "enumOption",
      keyPrefix: "userDataRights.privacyCenter.field.status.option.",
    });
  });

  test("gracePeriodEnd is hidden unless a deletion is actually pending", () => {
    const f = createUserDataRightsFeature();
    const screen = f.screens["privacy-center"];
    if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    const graceField = screen.layout.sections
      .flatMap((s) => ("fields" in s ? s.fields : []))
      .find((field) => typeof field === "object" && field.field === "gracePeriodEnd");
    expect(typeof graceField === "object" ? graceField.visible : undefined).toEqual({
      field: "status",
      eq: "deletionRequested",
    });
  });

  test("Restriction/Deletion actions dispatch the right handlers with the original confirm+visibility rules", () => {
    const f = createUserDataRightsFeature();
    const screen = f.screens["privacy-center"];
    if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    const byId = Object.fromEntries((screen.actions ?? []).map((a) => [a.id, a]));

    expect(byId["restrict"]).toMatchObject({
      handler: "user-data-rights:write:restrict-account",
      visible: { field: "status", ne: "restricted" },
    });
    expect(byId["restrict"]?.kind === "navigate" ? undefined : byId["restrict"]?.confirm).toBe(
      "userDataRights.privacyCenter.restriction.dialogDescription",
    );

    expect(byId["request-deletion"]).toMatchObject({
      handler: "user-data-rights:write:request-deletion",
      visible: { field: "status", ne: "deletionRequested" },
    });
    // Cancel has no confirm — the pre-#2312 custom screen executed it directly.
    expect(byId["cancel-deletion"]).toMatchObject({
      handler: "user-data-rights:write:cancel-deletion",
      visible: { field: "status", eq: "deletionRequested" },
    });
    expect((byId["cancel-deletion"] as { readonly confirm?: string }).confirm).toBeUndefined();
  });

  test("privacyCenterShowDeletion: false drops the deletion section + its actions", () => {
    const f = createUserDataRightsFeature({ privacyCenterShowDeletion: false });
    const screen = f.screens["privacy-center"];
    if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    expect(
      screen.layout.sections.some((s) => s.title === "userDataRights.privacyCenter.deletion.title"),
    ).toBe(false);
    const actionIds = (screen.actions ?? []).map((a) => a.id);
    expect(actionIds).not.toContain("request-deletion");
    expect(actionIds).not.toContain("cancel-deletion");
    expect(actionIds).toContain("restrict");
  });
});
