import { isApexHostname } from "./host.ts";
import type { HostRoutingOptions } from "./options.ts";

const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const PATH_PREFIX_PATTERN = /^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const LOCALE_PATTERN = /^[a-z]{2}(?:-[a-z]{2})?$/;

const REDIRECT_PATH_PATTERN = /^\/[A-Za-z0-9._~/-]*$/;
// A redirect target is either a same-origin path or an https URL; neither may
// carry a query or fragment, because the request's query string is appended.
const REDIRECT_TARGET_PATTERN =
  /^(?:\/(?!\/)[A-Za-z0-9._~/-]*|https:\/\/[a-z0-9.-]+(?::[0-9]{1,5})?(?:\/[A-Za-z0-9._~/-]*)?)$/;

function validateRedirects(options: HostRoutingOptions): void {
  for (const rule of options.redirects ?? []) {
    if (!REDIRECT_PATH_PATTERN.test(rule.from)) {
      throw new Error(`host-routing: redirect from must be a path like "/old", got "${rule.from}"`);
    }
    if (rule.from === "/api" || rule.from.startsWith("/api/")) {
      throw new Error(
        `host-routing: redirect from must not be an /api path, it would never fire, got "${rule.from}"`,
      );
    }
    if (!REDIRECT_TARGET_PATTERN.test(rule.to)) {
      throw new Error(
        `host-routing: redirect to must be a same-origin path or an https URL without query, got "${rule.to}"`,
      );
    }
    if (rule.host !== undefined && !DOMAIN_PATTERN.test(rule.host)) {
      throw new Error(
        `host-routing: redirect host must be a lowercase hostname, got "${rule.host}"`,
      );
    }
  }
}

function validateAnonymousQueryAllowlist(options: HostRoutingOptions): void {
  if (options.apexAnonymousQueryAllowlist !== undefined && options.tenantBy === "path") {
    // Path mode resolves as fallback-only: a client-sent X-Tenant or cookie wins
    // before the resolver runs, so the allowlist could never hold.
    throw new Error(
      'host-routing: apexAnonymousQueryAllowlist cannot be used with tenantBy "path", because the client names its tenant there and bypasses the allowlist',
    );
  }
  for (const host of Object.keys(options.apexAnonymousQueryAllowlist ?? {})) {
    if (!isApexHostname(host, options.baseDomain)) {
      throw new Error(
        `host-routing: apexAnonymousQueryAllowlist key must be the apex or www.<apex> hostname, got "${host}"`,
      );
    }
  }
}

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
  if (
    options.tenantPathPrefix !== undefined &&
    !PATH_PREFIX_PATTERN.test(options.tenantPathPrefix)
  ) {
    throw new Error(
      `host-routing: tenantPathPrefix must look like "/app" (leading slash, no trailing slash), got "${options.tenantPathPrefix}"`,
    );
  }
  validateRedirects(options);
  validateAnonymousQueryAllowlist(options);
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
