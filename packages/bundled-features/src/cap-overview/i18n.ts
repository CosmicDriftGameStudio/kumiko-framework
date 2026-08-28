type LocalizedString = { readonly en: string };

export const CAP_OVERVIEW_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:tenant-cap-list.title": { en: "Tenant caps" },
  "screen:my-caps.title": { en: "My usage" },
  "screen:platform-tenant-caps.title": { en: "Tenant dashboard" },
  "cap-overview.list.col.name": { en: "Tenant" },
  "cap-overview.list.col.tier": { en: "Tier" },
  "cap-overview.list.col.billing": { en: "Billing" },
  "cap-overview.list.filter.tier": { en: "Tier" },
  "cap-overview.list.action.open": { en: "Open dashboard" },
  "cap-overview.platform.filter.tenant": { en: "Tenant" },
  "cap-overview.cards.empty": { en: "No caps configured for this tenant." },
  "cap-overview.cards.loading": { en: "Loading usage…" },
  "cap-overview.notMeasured": { en: "Not measured yet" },
  "cap-overview.errors.progressPrimitiveMissing": {
    en: "Usage bar unavailable — Progress primitive is not registered.",
  },
  "cap-overview.errors.sortFieldUnsupported": { en: "Sorting by this field is not supported." },
  "cap-overview.errors.tenantOverrideRequiresSystemAdmin": {
    en: "Only SystemAdmin may query another tenant's data.",
  },
  "cap-overview.errors.tierFilterOpUnsupported": {
    en: "This filter operator is not supported for tier.",
  },
};
