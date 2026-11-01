import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const DOCUMENTS_BOOT_RULES = {
  negativeExpiringWithinDays: {
    id: "documents/negative-expiring-within-days",
    summary: "expiringWithinDays is not negative.",
    fix: "Pass zero or a positive number.",
  },
  categoryLabelUnknownCategory: {
    id: "documents/category-label-unknown-category",
    summary: "categoryLabels only names categories listed in categories.",
    fix: "Add the category to categories or drop its label.",
  },
} as const satisfies BootRuleTable;
