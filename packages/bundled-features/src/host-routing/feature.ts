import type { DbConnection, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
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
} from "../auth-foundation/index.js";
import {
  isTenantServingPublicContent,
  type TenantLifecycleStatus,
  tenantTable,
} from "../tenant/index.js";
import { HOST_ROUTING_FEATURE, TENANT_KEY_MAX_LENGTH } from "./constants.js";
import { classifyHost } from "./host.js";
import type { HostRoutingOptions } from "./options.js";
import { validateHostRoutingOptions } from "./validate-options.js";

type TenantRow = {
  readonly id: TenantId;
  readonly isEnabled: boolean;
  readonly status: TenantLifecycleStatus;
};

// Disabled tenants and tenants in any destroy phase are not routable, the same
// rule public files and pages follow.
async function servingTenantIdByKey(db: DbConnection | TenantDb, key: string): Promise<TenantId | null> {
  const row = await fetchOne<TenantRow>(db, tenantTable, { key });
  return row !== undefined && isTenantServingPublicContent(row) ? row.id : null;
}

async function isTenantServing(db: DbConnection, id: TenantId): Promise<boolean> {
  const row = await fetchOne<TenantRow>(db, tenantTable, { id });
  return row !== undefined && isTenantServingPublicContent(row);
}

type HostHeaderReader = { readonly req: { readonly header: (name: string) => string | undefined } };

// auth-foundation types the Hono context as unknown to stay free of a hono dep.
function isHostHeaderReader(c: unknown): c is HostHeaderReader {
  return (
    typeof c === "object" &&
    c !== null &&
    "req" in c &&
    typeof c.req === "object" &&
    c.req !== null &&
    "header" in c.req &&
    typeof c.req.header === "function"
  );
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

    if (options.tenantBy === "host") {
      const resolver: TenantResolverProvider = {
        trust: "authoritative",
        build: ({ db }) => {
          return async (c: unknown): Promise<TenantId | null> => {
            if (!isHostHeaderReader(c)) return null;
            const host = classifyHost(c.req.header("Host") ?? "", options);
            // Apex, fixed and unknown hosts have no anonymous tenant: an
            // authoritative null answers tenant_required, whatever X-Tenant says.
            return host.kind === "subdomain" ? servingTenantIdByKey(db, host.key) : null;
          };
        },
      };
      // biome-ignore lint/correctness/useHookAtTopLevel: r.useExtension is a registrar method, not a React hook; path mode must leave the resolver slot free.
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
