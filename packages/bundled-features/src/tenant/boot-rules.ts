import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const TENANT_BOOT_RULES = {
  assignableRoleMissingFromScreens: {
    id: "tenant/assignable-role-missing-from-screens",
    summary: "Every assignable app role is present in the tenant screens' options.",
    fix: "Pass assignableAppRoles: collectAssignableAppRoles(appFeatures) to createTenantFeature.",
  },
} as const satisfies BootRuleTable;
