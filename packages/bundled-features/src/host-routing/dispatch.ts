import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { RateLimitError, ValidationError } from "@cosmicdrift/kumiko-framework/errors";
import type { PageHeadSystemQuery } from "@cosmicdrift/kumiko-headless/apex";
import * as z from "zod";
import { HostRoutingQueries, isPathTenantKeyCandidate, isTenantKeyCandidate } from "./constants.ts";
import { classifyHost, splitFirstSegment, tenantKeyFromPath } from "./host.ts";
import type { HostRoutingOptions, HostRoutingSurface } from "./options.ts";
import { matchRedirect, sameOriginPath } from "./redirects.ts";
import { validateHostRoutingOptions } from "./validate-options.ts";

// Structurally identical to server-runtime's HostDispatchResult. Defined here
// because server-runtime depends on bundled-features, not the other way round;
// dev-server pins the compatibility with a type test.
export type HostRoutingDispatchResult =
  | { readonly kind: "html"; readonly file: string; readonly csp?: string }
  | { readonly kind: "redirect"; readonly to: string; readonly status?: 301 | 302 }
  | { readonly kind: "not-found"; readonly file?: string; readonly csp?: string };

export type HostRoutingRequest = {
  readonly host: string;
  readonly path: string;
  // Query string incl. leading "?", "" if none.
  readonly search: string;
};

export type HostRoutingDispatchFn = (
  req: HostRoutingRequest,
  deps: { readonly systemQuery: PageHeadSystemQuery },
) => Promise<HostRoutingDispatchResult>;

const tenantKeyExistsResultSchema = z.object({ exists: z.boolean() });

async function isTenantKeyKnown(systemQuery: PageHeadSystemQuery, key: string): Promise<boolean> {
  let result: unknown;
  try {
    result = await systemQuery(HostRoutingQueries.tenantKeyExists, { key }, SYSTEM_TENANT_ID);
  } catch (error) {
    if (error instanceof ValidationError) return false;
    // Over the rate limit every key looks the same: serve the tenant shell,
    // which leaks nothing; the API behind it still resolves the tenant itself.
    if (error instanceof RateLimitError) return true;
    throw error;
  }
  return tenantKeyExistsResultSchema.parse(result).exists;
}

async function isHostKnown(systemQuery: PageHeadSystemQuery, host: string): Promise<boolean> {
  let result: unknown;
  try {
    result = await systemQuery(HostRoutingQueries.hostTenantExists, { host }, SYSTEM_TENANT_ID);
  } catch (error) {
    if (error instanceof ValidationError) return false;
    // Unlike a tenant key, a rate-limited host is not served: it may not be one of ours.
    if (error instanceof RateLimitError) return false;
    throw error;
  }
  return tenantKeyExistsResultSchema.parse(result).exists;
}

function serve(
  surface: HostRoutingSurface,
  file: string = surface.file,
): HostRoutingDispatchResult {
  return surface.csp === undefined
    ? { kind: "html", file }
    : { kind: "html", file, csp: surface.csp };
}

function notFound(surface: HostRoutingSurface | undefined): HostRoutingDispatchResult {
  if (surface === undefined) return { kind: "not-found" };
  return surface.csp === undefined
    ? { kind: "not-found", file: surface.file }
    : { kind: "not-found", file: surface.file, csp: surface.csp };
}

function apexPage(options: HostRoutingOptions, req: HostRoutingRequest): HostRoutingDispatchResult {
  const { apex, locales } = options;
  if (locales === undefined) return serve(apex);
  const { segment, rest } = splitFirstSegment(req.path);
  if (segment === locales.default) {
    return { kind: "redirect", to: `${sameOriginPath(rest)}${req.search}`, status: 301 };
  }
  const locale = locales.prefixed.includes(segment) ? segment : locales.default;
  return serve(apex, apex.localeFiles?.[locale] ?? apex.file);
}

async function tenantPage(
  options: HostRoutingOptions,
  key: string | null,
  systemQuery: PageHeadSystemQuery,
  keySource: "path" | "subdomain",
): Promise<HostRoutingDispatchResult> {
  // No key (bare tenant prefix): the shell handles login and tenant choice.
  if (key === null) return serve(options.tenant);
  const isCandidate = keySource === "path" ? isPathTenantKeyCandidate : isTenantKeyCandidate;
  if (!isCandidate(key)) return notFound(options.unknownTenant);
  return (await isTenantKeyKnown(systemQuery, key))
    ? serve(options.tenant)
    : notFound(options.unknownTenant);
}

// The routing decision for runProdApp's `hostDispatch` (and, via
// toDevHostDispatch, the dev server). Unknown hosts fail closed with 404.
export function createHostDispatch(options: HostRoutingOptions): HostRoutingDispatchFn {
  validateHostRoutingOptions(options);
  const redirects = options.redirects ?? [];
  return async (req, { systemQuery }) => {
    const redirect = matchRedirect(redirects, req.host, req.path, req.search);
    if (redirect !== undefined) return { kind: "redirect", ...redirect };
    const host = classifyHost(req.host, options);
    switch (host.kind) {
      case "fixed":
        return serve(host.surface);
      case "unknown":
        return notFound(undefined);
      case "subdomain":
        if (options.tenantBy !== "host") return notFound(undefined);
        return tenantPage(options, host.key, systemQuery, "subdomain");
      case "resolved": {
        if (await isHostKnown(systemQuery, host.hostname)) return serve(options.tenant);
        return notFound(
          host.hostname.endsWith(`.${options.baseDomain.toLowerCase()}`)
            ? options.unknownTenant
            : undefined,
        );
      }
      case "apex": {
        if (options.tenantPathPrefix !== undefined) {
          const key = tenantKeyFromPath(options.tenantPathPrefix, req.path);
          if (key !== undefined) return tenantPage(options, key, systemQuery, "path");
        }
        return apexPage(options, req);
      }
    }
  };
}
