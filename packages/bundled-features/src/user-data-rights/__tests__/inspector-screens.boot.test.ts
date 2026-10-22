import { describe, expect, test } from "bun:test";
import { access, type RowAction, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createFilesFeature } from "@cosmicdrift/kumiko-framework/files";
import { computeEditViewModel } from "@cosmicdrift/kumiko-renderer/headless";
import { createAuthFoundationFeature } from "../../auth-foundation/index.ts";
import { createComplianceProfilesFeature } from "../../compliance-profiles/feature.ts";
import { createConfigFeature } from "../../config/feature.ts";
import { createDataRetentionFeature } from "../../data-retention/feature.ts";
import { createPersonalAccessTokensFeature } from "../../personal-access-tokens/index.ts";
import { createSessionsFeature } from "../../sessions/feature.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { createUserFeature } from "../../user/feature.ts";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults/feature.ts";
import { createUserDataRightsFeature } from "../feature.ts";

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
    createAuthFoundationFeature(),
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

// privacy-center converted from a custom screen to a declarative
// projectionDetail (Restriction/Deletion fields+actions, Export stays a
// custom extension section). `validateBoot` above already proves the
// screen clears every boot-validator rule for projectionDetail extension
// sections (entityName set, contributesToFormSubmit not true) — these
// tests pin the GDPR-relevant shape the type system can't check itself:
// which handler each action dispatches, the confirm-dialog description,
// and the visibility conditions carried over from the custom
// screen (restrict.tsx/deletion.tsx RestrictionSection/DeletionSection).
function sectionActionsOf(screen: {
  readonly layout: { readonly sections: readonly { readonly actions?: readonly RowAction[] }[] };
}): readonly RowAction[] {
  return screen.layout.sections.flatMap((s) => s.actions ?? []);
}

describe("privacy-center screen (fw#2312 projectionDetail conversion)", () => {
  test("is a projectionDetail bound to the user's own `me` query", () => {
    const f = createUserDataRightsFeature();
    const screen = f.screens["privacy-center"];
    expect(screen?.type).toBe("projectionDetail");
    if (screen?.type === "projectionDetail") {
      expect(screen.query).toBe("user:query:user:me");
      expect(screen.access).toEqual({
        openToAll: {
          reason:
            "each signed-in user manages GDPR self-service actions (export, restriction, deletion) for only their own account; the bound query and every action handler operate on the caller's own userId, and no app role name is portable enough to gate this",
        },
      });
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
    const byId = Object.fromEntries(sectionActionsOf(screen).map((a) => [a.id, a]));

    expect(byId["restrict"]).toMatchObject({
      handler: "user-data-rights:write:restrict-account",
      visible: { field: "status", ne: "restricted" },
    });
    const restrictAction = byId["restrict"];
    expect(
      restrictAction?.kind === "navigate" || restrictAction?.kind === "drawer"
        ? undefined
        : restrictAction?.confirm,
    ).toBe("userDataRights.privacyCenter.restriction.dialogDescription");

    expect(byId["request-deletion"]).toMatchObject({
      handler: "user-data-rights:write:request-deletion",
      visible: { field: "status", ne: "deletionRequested" },
    });
    // Cancel has no confirm — the custom screen executed it directly.
    expect(byId["cancel-deletion"]).toMatchObject({
      handler: "user-data-rights:write:cancel-deletion",
      visible: { field: "status", eq: "deletionRequested" },
      icon: "x",
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
    const actionIds = sectionActionsOf(screen).map((a) => a.id);
    expect(actionIds).not.toContain("request-deletion");
    expect(actionIds).not.toContain("cancel-deletion");
    expect(actionIds).toContain("restrict");
    expect(screen.description).toBe("userDataRights.privacyCenter.subtitleWithoutDeletion");
  });

  test("deletion configured: the deletion section is visible for every status; not configured: no section", () => {
    const sectionsShown = (showDeletion: boolean, status: string): readonly string[] => {
      const screen = createUserDataRightsFeature({ privacyCenterShowDeletion: showDeletion })
        .screens["privacy-center"];
      if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
      const vm = computeEditViewModel({
        screen: { id: screen.id, type: "entityEdit", entity: "me", layout: screen.layout },
        entity: {
          fields: {
            status: { type: "text", allowPlaintext: "test fixture value, not personal data" },
            gracePeriodEnd: {
              type: "text",
              allowPlaintext: "test fixture value, not personal data",
            },
          },
        },
        values: { status },
        translate: (key) => key,
        featureName: "user-data-rights",
      });
      return vm.sections.filter((s) => s.kind === "fields" && s.visible).map((s) => s.title ?? "");
    };
    const deletionTitle = "userDataRights.privacyCenter.deletion.title";

    expect(sectionsShown(true, "none")).toContain(deletionTitle);
    expect(sectionsShown(true, "deletionRequested")).toContain(deletionTitle);
    expect(sectionsShown(false, "none")).not.toContain(deletionTitle);
  });

  test("subtitle keeps the deletion wording while deletion is shown", () => {
    const screen = createUserDataRightsFeature().screens["privacy-center"];
    expect(screen?.description).toBe("userDataRights.privacyCenter.subtitle");
  });
});
