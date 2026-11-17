import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { ROLES } from "../../../auth/roles.ts";
import { validateBoot } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import type { FeatureDefinition } from "../../types/index.ts";
import { BootRuleViolation, BootValidationError } from "../boot-rule.ts";
import { validateJobRunAs } from "../job-run-as.ts";
import { collectKnownRoles } from "../nav.ts";

type JobOptions = {
  readonly runAs: { readonly roles: readonly string[] };
  readonly escapeHatch?: { readonly reason: string; readonly grants: readonly "systemIdentity"[] };
};

function thrownBy(fn: () => void): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected function to throw");
}

function ruleIdOfThrown(fn: () => void): string {
  const error = thrownBy(fn);
  if (error instanceof BootRuleViolation) return error.rule.id;
  throw error;
}

function ruleIdsOf(fn: () => void): readonly string[] {
  const error = thrownBy(fn);
  if (error instanceof BootValidationError) return error.violations.map((v) => v.ruleId);
  throw error;
}

const roleSource = defineFeature("runAsRoles", (r) => {
  r.queryHandler({
    name: "catalog",
    schema: z.object({}),
    handler: async () => ({}),
    access: { roles: [ROLES.SystemAdmin, ROLES.TenantAdmin] },
  });
});

function featureWithJob(options: JobOptions, systemScope = false): FeatureDefinition {
  return defineFeature("runAsJobs", (r) => {
    if (systemScope) r.systemScope();
    r.job("probe", { trigger: { manual: true }, ...options }, async () => {});
  });
}

const knownRoles = collectKnownRoles([roleSource]);

describe("job runAs", () => {
  test("an empty role list is rejected at r.job", () => {
    expect(ruleIdOfThrown(() => featureWithJob({ runAs: { roles: [] } }))).toBe("job/run-as-invalid");
  });

  test.each(["system", "anonymous"])("the reserved role %s is rejected at r.job", (role) => {
    expect(ruleIdOfThrown(() => featureWithJob({ runAs: { roles: [role] } }))).toBe("job/run-as-invalid");
  });

  test("a role no handler declares is an unknown role", () => {
    const feature = featureWithJob({ runAs: { roles: ["TenantAdmn"] } });
    expect(ruleIdOfThrown(() => validateJobRunAs(feature, knownRoles))).toBe("ownership/unknown-role");
  });

  test("SystemAdmin without a systemIdentity grant is rejected", () => {
    const feature = featureWithJob({ runAs: { roles: [ROLES.SystemAdmin] } });
    expect(ruleIdOfThrown(() => validateJobRunAs(feature, knownRoles))).toBe("job/run-as-system-admin-ungranted");
  });

  test("SystemAdmin with a systemIdentity escapeHatch passes", () => {
    const feature = featureWithJob({
      runAs: { roles: [ROLES.SystemAdmin] },
      escapeHatch: {
        reason: "test job reads the operator catalog as SystemAdmin",
        grants: ["systemIdentity"],
      },
    });
    expect(() => validateJobRunAs(feature, knownRoles)).not.toThrow();
  });

  test("SystemAdmin in an r.systemScope() feature passes", () => {
    const feature = featureWithJob({ runAs: { roles: [ROLES.SystemAdmin] } }, true);
    expect(() => validateJobRunAs(feature, knownRoles)).not.toThrow();
  });

  test("a tenant role passes", () => {
    const feature = featureWithJob({ runAs: { roles: [ROLES.TenantAdmin] } });
    expect(() => validateJobRunAs(feature, knownRoles)).not.toThrow();
  });

  test("validateBoot runs the check", () => {
    const typo = featureWithJob({ runAs: { roles: ["TenantAdmn"] } });
    expect(ruleIdsOf(() => validateBoot([roleSource, typo]))).toContain("ownership/unknown-role");
  });
});
