// Framework/pipeline stays bundled-features-free, so this can't import the
// `tenant` feature — the literal below IS the coupling to its `timezone`
// config key. Renaming that key (or the "tenant" feature name) must update
// this constant too; tenant-timezone-boot.integration.test.ts boots the real
// createTenantFeature() and would catch a drift.
export const TENANT_TIMEZONE_CONFIG_KEY = "tenant:config:timezone";
