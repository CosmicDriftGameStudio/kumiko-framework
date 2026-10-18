import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createFilesFeature } from "@cosmicdrift/kumiko-framework/files";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature.ts";
import { createAuthFoundationFeature } from "../../auth-foundation/index.ts";
import { createComplianceProfilesFeature } from "../../compliance-profiles/feature.ts";
import { createConfigFeature } from "../../config/feature.ts";
import { createDataRetentionFeature } from "../../data-retention/feature.ts";
import { createSessionsFeature } from "../../sessions/feature.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { createUserFeature } from "../../user/feature.ts";
import { createUserDataRightsFeature } from "../../user-data-rights/feature.ts";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults/feature.ts";
import { createUserProfileFeature } from "../feature.ts";

// fw#2312 — the `profile` screen converted from a custom React component to
// a declarative projectionDetail (change-password/change-email stay
// EditExtensionSection components, deletion is fields+actions). `validateBoot`
// below proves the screen clears every boot-validator rule for
// projectionDetail extension sections (entityName set, contributesToFormSubmit
// not true, action handlers resolve) — same pattern as user-data-rights'
// privacy-center screen (inspector-screens.boot.test.ts), which this mirrors.
describe("user-profile screen (fw#2312 projectionDetail conversion)", () => {
  const features = [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
    createAuthEmailPasswordFeature(),
    createDataRetentionFeature(),
    createComplianceProfilesFeature(),
    createAuthFoundationFeature(),
    createSessionsFeature(),
    createFilesFeature(),
    createUserDataRightsFeature(),
    createUserDataRightsDefaultsFeature(),
    createUserProfileFeature(),
  ];

  test("the assembled feature set boot-validates", () => {
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("is a projectionDetail bound to the user's own `me` query", () => {
    const f = createUserProfileFeature();
    const screen = f.screens["profile"];
    expect(screen?.type).toBe("projectionDetail");
    if (screen?.type === "projectionDetail") {
      expect(screen.query).toBe("user:query:user:me");
      expect(screen.access).toEqual({
        openToAll: {
          reason:
            "each signed-in user manages only their own profile: change-email/password re-authenticate the caller, and deletion request/cancel act on the caller's own userId; no app role name is portable enough to gate this",
        },
      });
    }
  });

  test("change-email/change-password are self-persisting extensions scoped to `user`", () => {
    const f = createUserProfileFeature();
    const screen = f.screens["profile"];
    if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    const extensionSections = screen.layout.sections.filter((s) => s.kind === "extension");
    expect(extensionSections).toHaveLength(2);
    for (const section of extensionSections) {
      expect(section.entityName).toBe("user");
      expect(section.contributesToFormSubmit).not.toBe(true);
    }
  });

  test("allowEmailChange: false drops the email section and the handler, and still boot-validates", () => {
    const f = createUserProfileFeature({ allowEmailChange: false });
    const screen = f.screens["profile"];
    if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    const extensionSections = screen.layout.sections.filter((s) => s.kind === "extension");
    expect(extensionSections.map((s) => s.title)).toEqual(["profile.password.title"]);
    expect(Object.keys(f.writeHandlers)).toEqual([]);
    const withoutEmail = features.map((x) => (x.name === "user-profile" ? f : x));
    expect(() => validateBoot(withoutEmail)).not.toThrow();
  });

  test("gracePeriodEnd is hidden unless a deletion is actually pending", () => {
    const f = createUserProfileFeature();
    const screen = f.screens["profile"];
    if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    const graceField = screen.layout.sections
      .flatMap((s) => ("fields" in s ? s.fields : []))
      .find((field) => typeof field === "object" && field.field === "gracePeriodEnd");
    expect(typeof graceField === "object" ? graceField.visible : undefined).toEqual({
      field: "status",
      eq: "deletionRequested",
    });
  });

  test("request-deletion/cancel-deletion actions dispatch user-data-rights handlers with the original confirm+visibility rules", () => {
    const f = createUserProfileFeature();
    const screen = f.screens["profile"];
    if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    const byId = Object.fromEntries((screen.actions ?? []).map((a) => [a.id, a]));

    expect(byId["request-deletion"]).toMatchObject({
      handler: "user-data-rights:write:request-deletion",
      confirm: "profile.danger.dialogDescription",
      visible: { field: "status", ne: "deletionRequested" },
      style: "danger",
    });
    // Cancel has no confirm — the pre-#2312 custom screen executed it directly.
    expect(byId["cancel-deletion"]).toMatchObject({
      handler: "user-data-rights:write:cancel-deletion",
      visible: { field: "status", eq: "deletionRequested" },
      icon: "x",
    });
    expect((byId["cancel-deletion"] as { readonly confirm?: string }).confirm).toBeUndefined();
  });
});
