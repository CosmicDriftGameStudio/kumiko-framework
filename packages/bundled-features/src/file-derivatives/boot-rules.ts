import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const FILE_DERIVATIVES_BOOT_RULES = {
  publicTenantResolutionWithoutApexResolver: {
    id: "file-derivatives/public-tenant-resolution-without-apex-resolver",
    summary: "publicTenantResolution is only set together with resolveApexTenant.",
    fix: "Pass resolveApexTenant or drop publicTenantResolution.",
  },
} as const satisfies BootRuleTable;
