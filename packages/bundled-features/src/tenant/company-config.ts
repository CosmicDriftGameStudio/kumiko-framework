import { type ConfigKeyDefinition, createTenantConfig } from "@cosmicdrift/kumiko-framework/engine";
import type { NavIconKey } from "@cosmicdrift/kumiko-types/nav";

export const COMPANY_DATA_KEYS = [
  "companyAddress",
  "companyPhone",
  "companyEmail",
  "companyWebsite",
  "companyRegister",
  "companyVatId",
  "companyManagement",
  "companyBank",
  "companyIban",
  "companyBic",
] as const;
export type CompanyDataKey = (typeof COMPANY_DATA_KEYS)[number];

export const COMPANY_SECTION_I18N_KEY = "tenant.company.section";

const COMPANY_KEY_ICONS: Readonly<Record<CompanyDataKey, NavIconKey>> = {
  companyAddress: "map-pin",
  companyPhone: "phone",
  companyEmail: "mail",
  companyWebsite: "link",
  companyRegister: "file",
  companyVatId: "receipt",
  companyManagement: "user",
  companyBank: "building",
  companyIban: "coins",
  companyBic: "hash",
};

export function companyI18nKey(key: CompanyDataKey): string {
  return `tenant.company.${key}`;
}

// Printed on documents (letterhead, footer); the generated settings screen groups them in one section.
export function companyDataConfig(key: CompanyDataKey): ConfigKeyDefinition<"text"> {
  return createTenantConfig("text", {
    default: "",
    mask: {
      title: companyI18nKey(key),
      icon: COMPANY_KEY_ICONS[key],
      order: 10 + COMPANY_DATA_KEYS.indexOf(key),
      section: COMPANY_SECTION_I18N_KEY,
    },
  });
}
