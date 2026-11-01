import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const TEMPLATE_RESOLVER_BOOT_RULES = {
  collectionRefusedKind: {
    id: "template-resolver/collection-refused-kind",
    summary: "Collections only use kinds that collections may write.",
    fix: "Pick an allowed collection kind.",
  },
  tenantEditableDuplicate: {
    id: "template-resolver/tenant-editable-duplicate",
    summary: "tenantEditable lists each kind and slug once.",
    fix: "Remove the duplicate entry.",
  },
  tenantEditableInvalidEntry: {
    id: "template-resolver/tenant-editable-invalid-entry",
    summary: "Each tenantEditable entry has a non-empty slug and at least one access role.",
    fix: "Give the entry a slug and roles.",
  },
} as const satisfies BootRuleTable;
