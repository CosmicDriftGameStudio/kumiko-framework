import { seedTextBlock } from "@cosmicdrift/kumiko-bundled-features/template-resolver/seeding";
import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { PLAN_TERMS_SLUG } from "./feature";

const TERMS_BY_LOCALE: Readonly<Record<string, string>> = {
  de: "Diese Bedingungen gelten für alle kostenpflichtigen Tarife des Nordlicht Mieterportals. Der Vertrag läuft monatlich und ist zum Ende des Abrechnungszeitraums kündbar.",
  en: "These terms apply to every paid plan of the Nordlicht tenant portal. The contract renews monthly and can be terminated at the end of the billing period.",
};

export const seedPlanTerms: SeedFn = async (stack) => {
  for (const [locale, content] of Object.entries(TERMS_BY_LOCALE)) {
    await seedTextBlock(stack.db, {
      tenantId: SYSTEM_TENANT_ID,
      slug: PLAN_TERMS_SLUG,
      locale,
      title: "Nutzungsbedingungen",
      content,
    });
  }
};
