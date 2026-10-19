import {
  defineFeature,
  defineQueryHandler,
  type FeatureDefinition,
  isSystemTenant,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import {
  EXT_TENANT_EXISTENCE,
  EXT_TENANT_RESOLVER,
  type TenantExistenceProvider,
  type TenantResolverProvider,
} from "../auth-foundation/index.ts";
import {
  HOST_HEADER_MAX_LENGTH,
  HOST_ROUTING_FEATURE,
  TENANT_KEY_MAX_LENGTH,
} from "./constants.ts";
import { classifyHost, normalizeHostname } from "./host.ts";
import type { HostRoutingOptions } from "./options.ts";
import {
  isTenantServing,
  servingTenantIdByKey,
  servingTenantIdByResolver,
} from "./tenant-lookup.ts";
import { validateHostRoutingOptions } from "./validate-options.ts";

type RequestReader = {
  readonly req: {
    readonly header: (name: string) => string | undefined;
    readonly url: string;
    readonly path: string;
    readonly raw?: Request;
  };
};

// auth-foundation types the Hono context as unknown to stay free of a hono dep.
function isRequestReader(c: unknown): c is RequestReader {
  return (
    typeof c === "object" &&
    c !== null &&
    "req" in c &&
    typeof c.req === "object" &&
    c.req !== null &&
    "header" in c.req &&
    typeof c.req.header === "function" &&
    "url" in c.req &&
    typeof c.req.url === "string" &&
    "path" in c.req &&
    typeof c.req.path === "string"
  );
}

// Hono routes on the decoded path and ignores a trailing slash, so the
// allowlist must compare the same shape: "/api/%71uery" and "/api/query/"
// reach the query handler too.
function routedPathOf(c: RequestReader): string {
  return c.req.path.length > 1 ? c.req.path.replace(/\/+$/, "") : c.req.path;
}

// "example.com" and "www.example.com" are one site: a host without its own
// entry falls back to the other variant's entry instead of keeping the anchor.
function allowlistFor(
  options: HostRoutingOptions,
  hostname: string,
): readonly string[] | undefined {
  const allowlists = options.apexAnonymousQueryAllowlist;
  if (allowlists === undefined) return undefined;
  const counterpart = hostname.startsWith("www.") ? hostname.slice(4) : `www.${hostname}`;
  for (const key of [hostname, counterpart]) {
    if (Object.hasOwn(allowlists, key)) return allowlists[key];
  }
  return undefined;
}

// Both carry { type, payload } and run read handlers; /api/batch is commands only.
const TYPED_READ_PATHS: ReadonlySet<string> = new Set(["/api/query", "/api/stream"]);
const queryTypeBodySchema = z.object({ type: z.string() });

// Reads the query type from a clone, so the body stays intact for the handler.
async function peekQueryType(c: RequestReader): Promise<string | null> {
  if (c.req.raw === undefined) return null;
  try {
    const parsed = queryTypeBodySchema.safeParse(await c.req.raw.clone().json());
    return parsed.success ? parsed.data.type : null;
  } catch {
    return null;
  }
}

// Apex anchor tenant for anonymous calls. A host with an allowlist only gets
// the anchor for the listed query types on read paths; other paths keep it.
async function apexAnchorFor(
  options: HostRoutingOptions,
  c: RequestReader,
  hostname: string,
): Promise<TenantId | null> {
  const anchor = options.apexAnonymousTenantId ?? null;
  if (anchor === null) return null;
  const allowlist = allowlistFor(options, hostname);
  if (allowlist === undefined || !TYPED_READ_PATHS.has(routedPathOf(c))) return anchor;
  const type = await peekQueryType(c);
  return type !== null && allowlist.includes(type) ? anchor : null;
}

// Returns only { exists }: the same fact the tenant 404 page already makes
// public, never other tenant fields. Rate-limited so it is no cheap oracle.
const tenantKeyExistsQuery = defineQueryHandler({
  name: "tenant-key-exists",
  schema: z.object({ key: z.string().min(1).max(TENANT_KEY_MAX_LENGTH) }),
  access: { roles: ["anonymous"] },
  rateLimit: { per: "ip+handler", limit: 120, windowSeconds: 60 },
  // Page-routing plumbing, not a task an agent performs.
  agent: { expose: false },
  description:
    "Anonymous existence check for a tenant key, backing the unknown-tenant 404 of the host-routing hostDispatch. Returns only { exists }.",
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message: "host-routing:query:tenant-key-exists requires ctx.systemDb (r.systemScope())",
      });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant(
      "tenant-key existence check for the host-routing 404 — publicly observable via the 404 itself",
    );
    return { exists: (await servingTenantIdByKey(db, query.payload.key)) !== null };
  },
});

function hostTenantExistsQueryFor(options: HostRoutingOptions) {
  return defineQueryHandler({
    name: "host-tenant-exists",
    schema: z.object({ host: z.string().min(1).max(HOST_HEADER_MAX_LENGTH) }),
    access: { roles: ["anonymous"] },
    rateLimit: { per: "ip+handler", limit: 120, windowSeconds: 60 },
    // Page-routing plumbing, not a task an agent performs.
    agent: { expose: false },
    description:
      "Anonymous host check backing the unknown-host 404 of the host-routing hostDispatch in tenantBy resolver mode. Returns only { exists }.",
    handler: async (query, ctx) => {
      if (!ctx.systemDb) {
        throw new InternalError({
          message: "host-routing:query:host-tenant-exists requires ctx.systemDb (r.systemScope())",
        });
      }
      const hostname = normalizeHostname(query.payload.host);
      if (hostname === null) return { exists: false };
      const db = ctx.systemDb.acknowledgeCrossTenant(
        "host existence check for the host-routing 404 — publicly observable via the 404 itself",
      );
      return { exists: (await servingTenantIdByResolver(options, db, hostname)) !== null };
    },
  });
}

function tenantResolverFor(options: HostRoutingOptions): TenantResolverProvider | undefined {
  if (options.tenantBy !== "path") {
    return {
      trust: "authoritative",
      build:
        ({ db }) =>
        async (c: unknown): Promise<TenantId | null> => {
          if (!isRequestReader(c)) return null;
          const hostHeader = c.req.header("Host") ?? "";
          const host = classifyHost(hostHeader, options);
          // Fixed and unknown hosts have no anonymous tenant: an authoritative
          // null answers tenant_required, whatever X-Tenant says.
          switch (host.kind) {
            case "subdomain":
              return servingTenantIdByKey(db, host.key);
            case "resolved":
              return servingTenantIdByResolver(options, db, host.hostname);
            case "apex":
              return apexAnchorFor(options, c, normalizeHostname(hostHeader) ?? "");
            case "fixed":
            case "unknown":
              return null;
          }
        },
    };
  }
  if (options.apexAnonymousTenantId === undefined) return undefined;
  // Path mode: the client names its tenant; the apex default only fills in
  // when it does not.
  return {
    trust: "fallback-only",
    build: () => async (c: unknown) => {
      if (!isRequestReader(c)) return null;
      const hostHeader = c.req.header("Host") ?? "";
      return classifyHost(hostHeader, options).kind === "apex"
        ? apexAnchorFor(options, c, normalizeHostname(hostHeader) ?? "")
        : null;
    },
  };
}

// Server half of host routing: the tenant for anonymous API requests comes
// from the Host header only (never from X-Tenant), and a client-named tenant
// must exist, be enabled and be active. The page half is createHostDispatch.
export function createHostRoutingFeature(options: HostRoutingOptions): FeatureDefinition {
  validateHostRoutingOptions(options);
  return defineFeature(HOST_ROUTING_FEATURE, (r) => {
    r.describe(
      "Host- and path-based tenant routing: an authoritative tenant resolver from the subdomain (tenantBy host), a tenant existence check against enabled, active tenants, and the tenant-key query behind createHostDispatch, which picks the HTML file, CSP, locale redirect or 404 per host for runProdApp's hostDispatch.",
    );
    r.requires({ features: ["auth-foundation", "tenant"] });
    r.systemScope();
    r.queryHandler(tenantKeyExistsQuery);
    if (typeof options.tenantBy === "function") r.queryHandler(hostTenantExistsQueryFor(options));

    const resolver = tenantResolverFor(options);
    if (resolver !== undefined) {
      // biome-ignore lint/correctness/useHookAtTopLevel: r.useExtension is a registrar method, not a React hook; path mode without an apex tenant must leave the resolver slot free.
      r.useExtension(EXT_TENANT_RESOLVER, "host", resolver);
    }

    const existence: TenantExistenceProvider = {
      build:
        ({ db }) =>
        (tenantId: string) =>
          isSystemTenant(tenantId) ? true : isTenantServing(db, tenantId),
    };
    r.useExtension(EXT_TENANT_EXISTENCE, "active-tenant", existence);
  });
}
