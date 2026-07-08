import { describe, expect, test } from "bun:test";
import { access, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config/feature";
import { AUDIT_LOG_DETAIL_SCREEN_ID, AUDIT_LOG_SCREEN_ID, AuditQueries } from "../constants";
import { createAuditFeature } from "../feature";

describe("audit log screen + handler access alignment", () => {
  const features = [createConfigFeature(), createAuditFeature()];

  test("boot-validates with audit-log screen registered", () => {
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("audit-log screen is custom, access.admin-gated", () => {
    const audit = createAuditFeature();
    const screen = audit.screens[AUDIT_LOG_SCREEN_ID];
    expect(screen?.type).toBe("custom");
    if (screen && "access" in screen && screen.access && "roles" in screen.access) {
      expect(screen.access.roles).toEqual(access.admin);
    }
  });

  test("audit-log-detail screen is custom, admin-gated, breadcrumb-linked to list", () => {
    const audit = createAuditFeature();
    const screen = audit.screens[AUDIT_LOG_DETAIL_SCREEN_ID];
    expect(screen?.type).toBe("custom");
    if (screen && "listScreenId" in screen) {
      expect(screen.listScreenId).toBe(AUDIT_LOG_SCREEN_ID);
    }
    if (screen && "access" in screen && screen.access && "roles" in screen.access) {
      expect(screen.access.roles).toEqual(access.admin);
    }
  });

  test("audit queries use access.admin (screen ⊆ handler)", () => {
    const audit = createAuditFeature();
    expect(rolesOf(audit.queryHandlers["list"]?.access)).toEqual([...access.admin]);
    expect(rolesOf(audit.queryHandlers["details"]?.access)).toEqual([...access.admin]);
    void AuditQueries;
  });
});
