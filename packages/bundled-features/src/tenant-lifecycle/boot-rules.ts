import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const TENANT_LIFECYCLE_BOOT_RULES = {
  tenantSubjectWithoutDestroyHook: {
    id: "tenant-lifecycle/tenant-subject-without-destroy-hook",
    summary:
      "An entity with tenant-subject fields has an EXT_TENANT_DATA destroy hook, so tenant destroy erases its data.",
    fix: 'Register r.useExtension(EXT_TENANT_DATA, "<entity>", { destroy }) or a documented no-op if crypto-shredding covers it.',
  },
  destroyFunctionMissing: {
    id: "tenant-lifecycle/destroy-function-missing",
    summary:
      "A tenant data or tenant resource extension registration provides its destroy function, otherwise tenant destroy fails at that stage.",
    fix: "Provide destroy (EXT_TENANT_DATA) or destroyTenant (tenant resource extensions) in the registration options.",
  },
} as const satisfies BootRuleTable;
