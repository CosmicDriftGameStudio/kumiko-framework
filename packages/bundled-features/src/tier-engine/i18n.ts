// @runtime client
// Default-Bundles für den TierAdminScreen. Werden vom tierEngineClient()
// als Fallback-Bundle in den LocaleProvider gehängt — Apps überschreiben
// einzelne Keys via `tierEngineClient({ translations: { de: { … } } })`.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

type LocalizedString = { readonly de: string; readonly en: string; readonly es: string };

export const TIER_ENGINE_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:tier-admin.title": {
    de: "Tier manuell zuweisen",
    en: "Assign tier manually",
    es: "Asignar tier manualmente",
  },
};

export const defaultTranslations: TranslationsByLocale = {
  de: {
    "screen:tier-admin.title": "Tier manuell zuweisen",
    "tier-admin.title": "Tier manuell zuweisen",
    "tier-admin.explainer":
      "Weise einem Tenant ein Tier ohne Kauf zu. Der Grant wird als „manuell“ markiert und von einem späteren Billing-Sync nicht überschrieben.",
    "tier-admin.tenant.label": "Tenant",
    "tier-admin.current.label": "Aktuelles Tier",
    "tier-admin.current.none": "— noch keins —",
    "tier-admin.tier.label": "Neues Tier",
    "tier-admin.submit": "Tier zuweisen",
    "tier-admin.success": "Tier „{tier}“ zugewiesen.",
    "tier-admin.error.generic": "Konnte das Tier nicht zuweisen.",
    "tier-admin.error.load": "Tenants konnten nicht geladen werden.",
    "tier-admin.error.noTiers":
      "Diese App hat keine TierMap konfiguriert — es gibt keine zuweisbaren Tiers.",
  },
  en: {
    "screen:tier-admin.title": "Assign tier manually",
    "tier-admin.title": "Assign tier manually",
    "tier-admin.explainer":
      "Grant a tenant a tier without a purchase. The grant is marked as “manual” and a later billing sync won't overwrite it.",
    "tier-admin.tenant.label": "Tenant",
    "tier-admin.current.label": "Current tier",
    "tier-admin.current.none": "— none yet —",
    "tier-admin.tier.label": "New tier",
    "tier-admin.submit": "Assign tier",
    "tier-admin.success": "Assigned tier “{tier}”.",
    "tier-admin.error.generic": "Could not assign the tier.",
    "tier-admin.error.load": "Failed to load tenants.",
    "tier-admin.error.noTiers":
      "This app has no TierMap configured — there are no assignable tiers.",
  },
  es: {
    "screen:tier-admin.title": "Asignar tier manualmente",
    "tier-admin.title": "Asignar tier manualmente",
    "tier-admin.explainer":
      "Asigna un tier a un tenant sin necesidad de compra. La asignación se marca como «manual» y no será sobrescrita por una sincronización de facturación posterior.",
    "tier-admin.tenant.label": "Tenant",
    "tier-admin.current.label": "Tier actual",
    "tier-admin.current.none": "— aún ninguno —",
    "tier-admin.tier.label": "Nuevo tier",
    "tier-admin.submit": "Asignar tier",
    "tier-admin.success": "Tier «{tier}» asignado.",
    "tier-admin.error.generic": "No se pudo asignar el tier.",
    "tier-admin.error.load": "No se pudieron cargar los tenants.",
    "tier-admin.error.noTiers":
      "Esta aplicación no tiene una TierMap configurada — no hay tiers asignables.",
  },
};
