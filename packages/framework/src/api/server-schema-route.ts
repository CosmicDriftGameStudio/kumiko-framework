import type { Hono } from "hono";
import { buildAppSchema } from "../engine/build-app-schema.ts";
import { projectAppSchemaForRoles } from "../engine/project-app-schema-for-roles.ts";
import {
  resolveDisabledFeatureNames,
  stripDisabledFeaturesFromAppSchema,
} from "../engine/strip-disabled-features-from-app-schema.ts";
import { stripUnreadableRelatedLists } from "../engine/strip-unreadable-related-lists.ts";
import type { AppSchema } from "../ui-types/app-schema.ts";
import { Routes } from "./api-constants.ts";
import { getUser } from "./auth-middleware.ts";
import { computeStrongEtag, etagMatches } from "./http-cache.ts";
import type { ServerOptions } from "./server.ts";
import { isMissingOrAnonymousUser, unauthenticatedResponse } from "./server-routes.ts";

export function mountSchemaRoute(
  app: Hono,
  options: Pick<ServerOptions, "registry" | "dispatcherOptions" | "context">,
): void {
  // GET /api/schema — the only way a client obtains the AppSchema. Behind
  // jwtGuard (NON_PUBLIC_API_PATHS), so anonymousAccess's synthesised user
  // also gets rejected below — the schema never reaches an unauthenticated
  // caller. The FULL schema is built lazily once — the registry is
  // immutable for this server's lifetime, so it's the same on every
  // request — then projected per caller-role-set (a role only
  // sees the screens/navs/workspaces/content-collections it may reach,
  // not the whole app's schema) and cached per role key. Tenant is
  // deliberately NOT part of the key: the projection depends only on
  // roles, and per-tenant caching would grow unboundedly across tenants
  // that share the same role set. What IS part of the key: the sorted set of
  // features the caller's tenant has switched off (r.toggleable) — few
  // distinct sets, so the cache stays small. The resolver is read per request
  // because run{Dev,Prod}App fill it in after the server is built.
  let fullSchema: AppSchema | undefined;
  const projectedSchemaCache = new Map<string, { readonly json: string; readonly etag: string }>();
  app.get(`/api${Routes.schema}`, async (c) => {
    const user = getUser(c);
    if (isMissingOrAnonymousUser(user)) {
      return unauthenticatedResponse(c);
    }
    const effectiveFeatures = options.dispatcherOptions?.effectiveFeatures;
    const disabledFeatureNames =
      effectiveFeatures === undefined
        ? []
        : await resolveDisabledFeatureNames(options.registry, effectiveFeatures, user.tenantId);
    const roleKey = JSON.stringify([[...new Set(user?.roles ?? [])].sort(), disabledFeatureNames]);
    let cached = projectedSchemaCache.get(roleKey);
    if (cached === undefined) {
      if (fullSchema === undefined) {
        fullSchema = buildAppSchema(options.registry, {
          searchAdapterMissing: !options.context.searchAdapter,
        });
      }
      const roles = user?.roles ?? [];
      const projected = stripUnreadableRelatedLists(
        projectAppSchemaForRoles(
          stripDisabledFeaturesFromAppSchema(fullSchema, options.registry, disabledFeatureNames),
          roles,
        ),
        roles,
        (queryQn) => options.registry.getQueryHandler(queryQn)?.access,
      );
      const json = JSON.stringify(projected);
      cached = { json, etag: computeStrongEtag(json) };
      projectedSchemaCache.set(roleKey, cached);
    }
    const cacheHeaders = { "Cache-Control": "private, no-cache", ETag: cached.etag };
    if (etagMatches(c.req.header("If-None-Match") ?? null, cached.etag)) {
      return c.body(null, 304, cacheHeaders);
    }
    return c.body(cached.json, 200, {
      "Content-Type": "application/json; charset=utf-8",
      ...cacheHeaders,
    });
  });
}
