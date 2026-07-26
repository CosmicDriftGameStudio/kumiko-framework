// tenant-settings bundle constants — feature-name + qualified config names.
//
// Motivation (solon#P19): apps kept hard-coding a single currency/locale
// literal per money/select field ("EUR", "de") instead of one per-tenant
// setting — expensive to retrofit once a second tenant needs a different
// default. This bundle is the one place that setting lives.

export const TENANT_SETTINGS_FEATURE_NAME = "tenant-settings";

// Qualified config key names (QN format: scope:config:name) for
// ctx.config(...) reads. Clients reference the object instead of magic
// strings (mirror tags' Handlers/Queries constants).
export const TenantSettingsConfig = {
  currency: "tenant-settings:config:currency",
  locale: "tenant-settings:config:locale",
} as const;
