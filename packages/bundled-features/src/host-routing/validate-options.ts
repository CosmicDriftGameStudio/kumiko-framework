import type { HostRoutingOptions } from "./options.js";

const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const PATH_PREFIX_PATTERN = /^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const LOCALE_PATTERN = /^[a-z]{2}(?:-[a-z]{2})?$/;

// Checked once when the app composes its features, so a config typo fails
// the boot instead of routing every request to a 404.
export function validateHostRoutingOptions(options: HostRoutingOptions): void {
  if (!DOMAIN_PATTERN.test(options.baseDomain)) {
    throw new Error(
      `host-routing: baseDomain must be a lowercase hostname without port, got "${options.baseDomain}"`,
    );
  }
  for (const host of Object.keys(options.hosts ?? {})) {
    if (!DOMAIN_PATTERN.test(host)) {
      throw new Error(`host-routing: hosts key must be a lowercase hostname, got "${host}"`);
    }
  }
  if (options.tenantBy === "path" && !PATH_PREFIX_PATTERN.test(options.tenantPathPrefix)) {
    throw new Error(
      `host-routing: tenantPathPrefix must look like "/app" (leading slash, no trailing slash), got "${options.tenantPathPrefix}"`,
    );
  }
  const { locales } = options;
  if (locales !== undefined) {
    for (const locale of [locales.default, ...locales.prefixed]) {
      if (!LOCALE_PATTERN.test(locale)) {
        throw new Error(`host-routing: locale must look like "de" or "de-at", got "${locale}"`);
      }
    }
    if (locales.prefixed.includes(locales.default)) {
      throw new Error(
        `host-routing: default locale "${locales.default}" is served unprefixed and must not be in prefixed`,
      );
    }
  }
}
