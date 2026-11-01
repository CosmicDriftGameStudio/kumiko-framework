import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const BILLING_FOUNDATION_BOOT_RULES = {
  consumerProtectionInvalid: {
    id: "billing-foundation/consumer-protection-invalid",
    summary:
      "consumerProtection options carry non-empty texts, a valid operator email, a valid termination scope and valid legal links.",
    fix: "Fix the consumerProtection option named in the error message.",
  },
  baseUrlInvalid: {
    id: "billing-foundation/base-url-invalid",
    summary: "baseUrl is a parseable absolute http or https URL.",
    fix: "Pass an absolute http(s) URL as baseUrl.",
  },
  baseUrlRequired: {
    id: "billing-foundation/base-url-required",
    summary: "baseUrl is set whenever consumerProtection or a catalog is configured.",
    fix: "Pass baseUrl, checkout redirect URLs are built from it.",
  },
  catalogInvalid: {
    id: "billing-foundation/catalog-invalid",
    summary:
      "The catalog declares unique plans, root-relative paths, view roles and a valid contact card.",
    fix: "Fix the catalog option named in the error message.",
  },
} as const satisfies BootRuleTable;
