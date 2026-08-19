import {
  access,
  type ConfigKeyDefinition,
  createTenantConfig,
  DEFAULT_CURRENCIES,
  DEFAULT_LOCALES,
} from "@cosmicdrift/kumiko-framework/engine";

export type TenantSettingsKeyOptions = {
  /** Selectable currencies. Default: DEFAULT_CURRENCIES (engine). */
  readonly currencies?: readonly string[];
  /** Fallback when a tenant never set the key. Default: "EUR". */
  readonly defaultCurrency?: string;
  /** Selectable locales. Default: DEFAULT_LOCALES (engine). */
  readonly locales?: readonly string[];
  /** Fallback when a tenant never set the key. Default: "en". */
  readonly defaultLocale?: string;
  /** Who may change the tenant's settings. Default: access.admin. */
  readonly write?: readonly string[];
};

export function buildTenantSettingsKeys(
  opts: TenantSettingsKeyOptions = {},
): Record<string, ConfigKeyDefinition> {
  const write = opts.write ?? access.admin;
  return {
    // `mask` surfaces the key in the self-populating Settings-Hub (Tenant-
    // Audience) without a hand-written r.screen/r.nav — see
    // samples/recipes/managed-config for the mechanism.
    currency: createTenantConfig("select", {
      default: opts.defaultCurrency ?? "EUR",
      options: opts.currencies ?? DEFAULT_CURRENCIES,
      write,
      mask: { title: "tenant-settings.currency", icon: "coins", order: 1 },
    }),
    locale: createTenantConfig("select", {
      default: opts.defaultLocale ?? "en",
      options: opts.locales ?? DEFAULT_LOCALES,
      write,
      mask: { title: "tenant-settings.locale", icon: "languages", order: 2 },
    }),
  } satisfies Record<string, ConfigKeyDefinition>;
}
