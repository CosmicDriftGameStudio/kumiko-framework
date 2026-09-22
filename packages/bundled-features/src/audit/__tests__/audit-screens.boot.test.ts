import { describe, expect, test } from "bun:test";
import { access, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import {
  isFieldsEditSection,
  normalizeEditField,
  normalizeListColumn,
  sectionFieldSpecs,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { createConfigFeature } from "../../config/feature";
import { createTenantFeature } from "../../tenant/feature";
import { createUserFeature } from "../../user/feature";
import { AUDIT_LOG_DETAIL_SCREEN_ID, AUDIT_LOG_SCREEN_ID, AuditQueries } from "../constants";
import { createAuditFeature } from "../feature";
import { AUDIT_I18N } from "../i18n";

describe("audit log screen + handler access alignment", () => {
  const features = [
    createConfigFeature(),
    createTenantFeature(),
    createUserFeature(),
    createAuditFeature(),
  ];

  test("boot-validates with audit-log screen registered", () => {
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("the user:user actor reference makes `user` a hard boot dependency (fw#3103)", () => {
    // fw#3108's refEntity check now catches the missing "user" feature before the "requires" check does.
    expect(() =>
      validateBoot([createConfigFeature(), createTenantFeature(), createAuditFeature()]),
    ).toThrow(/refEntity\) targets entity "user:user".*Known entities in feature "user": \(none\)/);
  });

  test("audit-log screen is declarative, access.admin-gated", () => {
    const audit = createAuditFeature();
    const screen = audit.screens[AUDIT_LOG_SCREEN_ID];
    if (screen?.type !== "projectionList") {
      throw new Error(
        `expected a projectionList screen for ${AUDIT_LOG_SCREEN_ID}, got ${screen?.type}`,
      );
    }
    if (!("access" in screen) || !screen.access || !("roles" in screen.access)) {
      throw new Error(`expected role-gated access on ${AUDIT_LOG_SCREEN_ID}`);
    }
    expect(screen.access.roles).toEqual(access.admin);
  });

  test("audit-log-detail screen is declarative, admin-gated, breadcrumb-linked to list", () => {
    const audit = createAuditFeature();
    const screen = audit.screens[AUDIT_LOG_DETAIL_SCREEN_ID];
    if (screen?.type !== "projectionDetail") {
      throw new Error(
        `expected a projectionDetail screen for ${AUDIT_LOG_DETAIL_SCREEN_ID}, got ${screen?.type}`,
      );
    }
    if (!("listScreenId" in screen)) {
      throw new Error(`expected listScreenId on ${AUDIT_LOG_DETAIL_SCREEN_ID}`);
    }
    expect(screen.listScreenId).toBe(AUDIT_LOG_SCREEN_ID);
    if (!("access" in screen) || !screen.access || !("roles" in screen.access)) {
      throw new Error(`expected role-gated access on ${AUDIT_LOG_DETAIL_SCREEN_ID}`);
    }
    expect(screen.access.roles).toEqual(access.admin);
  });

  test("audit-log-detail: aggregate type and aggregate id resolve to distinct labels", () => {
    const audit = createAuditFeature();
    const screen = audit.screens[AUDIT_LOG_DETAIL_SCREEN_ID];
    if (screen?.type !== "projectionDetail") {
      throw new Error(
        `expected a projectionDetail screen for ${AUDIT_LOG_DETAIL_SCREEN_ID}, got ${screen?.type}`,
      );
    }
    const aggregateTypeKey = screen.fieldLabels?.["aggregateType"];
    const aggregateIdKey = screen.fieldLabels?.["aggregateId"];
    if (aggregateTypeKey === undefined || aggregateIdKey === undefined) {
      throw new Error("expected fieldLabels for both aggregateType and aggregateId");
    }
    expect(aggregateTypeKey).not.toBe(aggregateIdKey);
    expect(AUDIT_I18N[aggregateTypeKey]?.en).not.toBe(AUDIT_I18N[aggregateIdKey]?.en);
  });

  test("actor column and detail field declare the user:user reference (fw#3103)", () => {
    const audit = createAuditFeature();
    expect(audit.requires).toContain("user");

    const list = audit.screens[AUDIT_LOG_SCREEN_ID];
    if (list?.type !== "projectionList") throw new Error("expected a projectionList screen");
    const actorColumn = list.columns.map(normalizeListColumn).find((c) => c.field === "createdBy");
    expect(actorColumn?.refEntity).toBe("user:user");
    expect(actorColumn?.refLabelField).toBe("displayName");

    const detail = audit.screens[AUDIT_LOG_DETAIL_SCREEN_ID];
    if (detail?.type !== "projectionDetail") throw new Error("expected a projectionDetail screen");
    const actorField = detail.layout.sections
      .filter(isFieldsEditSection)
      .flatMap((section) => sectionFieldSpecs(section))
      .map(normalizeEditField)
      .find((f) => f.field === "createdBy");
    expect(actorField?.refEntity).toBe("user:user");
    expect(actorField?.refLabelField).toBe("displayName");
  });

  test("audit queries use access.admin (screen ⊆ handler)", () => {
    const audit = createAuditFeature();
    expect(rolesOf(audit.queryHandlers["list"]?.access)).toEqual([...access.admin]);
    expect(rolesOf(audit.queryHandlers["details"]?.access)).toEqual([...access.admin]);
    void AuditQueries;
  });
});
