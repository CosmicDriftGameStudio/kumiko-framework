import {
  access,
  type ConfigKeyDefinition,
  createTenantConfig,
} from "@cosmicdrift/kumiko-framework/engine";

export const SEO_FEATURE = "seo" as const;

// Default mount paths — override per-app via SeoOptions.basePaths for
// non-standard mounts (e.g. a reverse-proxy that already serves /robots.txt).
export const SEO_DEFAULT_PATHS = {
  sitemap: "/sitemap.xml",
  llmsTxt: "/llms.txt",
  robots: "/robots.txt",
} as const;

// Tenant-scoped, admin-writable metadata feeding the Organization JSON-LD
// helper + llms.txt summary + OG default image. No `seo-site-url` key —
// absolute URLs are derived from the request's own Host (mirrors managed-
// pages' resolveApexTenant pattern), so a single seo mount works correctly
// across multiple apex hosts without a static site-url config drifting.
const TEXT_PATTERN = { regex: "^[\\s\\S]{0,500}$" } as const;
const HTTPS_PATTERN = { regex: "^$|^https://[^\\s\"'<>]{1,2000}$" } as const;
const SEO_WRITE = access.withSystem(access.admin);

export const SEO_CONFIG_KEYS = {
  seoOrganizationName: createTenantConfig("text", {
    default: "",
    pattern: TEXT_PATTERN,
    write: SEO_WRITE,
  }),
  seoOrganizationLogoUrl: createTenantConfig("text", {
    default: "",
    pattern: HTTPS_PATTERN,
    write: SEO_WRITE,
  }),
  seoTwitterSite: createTenantConfig("text", {
    default: "",
    pattern: TEXT_PATTERN,
    write: SEO_WRITE,
  }),
  seoLlmsSummary: createTenantConfig("text", {
    default: "",
    pattern: TEXT_PATTERN,
    write: SEO_WRITE,
  }),
  seoDefaultOgImage: createTenantConfig("text", {
    default: "",
    pattern: HTTPS_PATTERN,
    write: SEO_WRITE,
  }),
} satisfies Record<string, ConfigKeyDefinition>;

export const SEO_CONFIG_QN = {
  organizationName: "seo:config:seo-organization-name",
  organizationLogoUrl: "seo:config:seo-organization-logo-url",
  twitterSite: "seo:config:seo-twitter-site",
  llmsSummary: "seo:config:seo-llms-summary",
  defaultOgImage: "seo:config:seo-default-og-image",
} as const;
