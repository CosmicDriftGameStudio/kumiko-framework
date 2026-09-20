import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { type APIRequestContext, test as base, type Page } from "@playwright/test";
import type { z } from "zod";
import {
  type BoundApi,
  type SeededCredentials,
  type SeededTenant,
  type SeededUser,
  type SeedTenantOptions,
  withSession,
} from "../seed-types";
import { createHttpApi, loginViaApi } from "./auth-kit";
import { SEED_ROUTES } from "./constants";
import { seedRouteHeaders } from "./mail-capture";
import {
  type SeedUserRequest,
  seedTenantResponseSchema,
  seedUserResponseSchema,
} from "./seed-contract";

export type E2eSeedTenantOptions = Omit<SeedTenantOptions, "persist">;

export type E2eSeededTenant = SeededTenant & {
  readonly loginAs: (page: Page, user: SeededUser) => Promise<void>;
};

type E2eFixtures = {
  seedTenant: (opts?: E2eSeedTenantOptions) => Promise<E2eSeededTenant>;
};

async function postSeedRoute<S extends z.ZodType>(
  request: APIRequestContext,
  path: string,
  body: Record<string, unknown>,
  schema: S,
): Promise<z.infer<S>> {
  const response = await request.post(path, { headers: seedRouteHeaders(), data: body });
  if (!response.ok()) {
    throw new Error(`seedTenant: POST ${path} -> ${response.status()} ${await response.text()}`);
  }
  return schema.parse(await response.json());
}

export const test = base.extend<E2eFixtures>({
  seedTenant: async ({ request, context, playwright, baseURL }, use) => {
    if (baseURL === undefined) throw new Error("seedTenant: the Playwright config has no baseURL");
    const openedContexts: APIRequestContext[] = [];
    const apiByUserId = new Map<string, BoundApi>();

    // One cookie jar per user: two tenants (or admin + member) in one test must not clobber each other's session.
    const openLoggedInApi = async (user: SeededUser): Promise<BoundApi> => {
      const ctx = await playwright.request.newContext({ baseURL });
      openedContexts.push(ctx);
      await loginViaApi(ctx, user);
      return createHttpApi(ctx);
    };

    const httpApiFor = (user: SeededUser): BoundApi => {
      const cached = apiByUserId.get(user.id);
      if (cached !== undefined) return cached;
      let opened: Promise<BoundApi> | undefined;
      const bound = (): Promise<BoundApi> => {
        opened ??= openLoggedInApi(user);
        return opened;
      };
      const api: BoundApi = {
        writeOk: async (type, payload, requestId) =>
          (await bound()).writeOk(type, payload, requestId),
        writeErr: async (type, payload) => (await bound()).writeErr(type, payload),
        queryOk: async (type, payload) => (await bound()).queryOk(type, payload),
        queryErr: async (type, payload) => (await bound()).queryErr(type, payload),
      };
      apiByUserId.set(user.id, api);
      return api;
    };

    const loginAs = async (page: Page, user: SeededUser): Promise<void> => {
      await page.context().clearCookies();
      await loginViaApi(page.context().request, user);
    };

    await use(async (opts = {}) => {
      const seeded = await postSeedRoute(
        request,
        SEED_ROUTES.seedTenant,
        { name: opts.name, members: opts.users },
        seedTenantResponseSchema,
      );
      const tenantId = seeded.id;
      const toUser = (credentials: SeededCredentials, roles: readonly string[]): SeededUser =>
        withSession(credentials, tenantId, roles);

      const admin = toUser(seeded.admin, [ROLES.TenantAdmin]);
      await loginViaApi(context.request, admin);

      const tenant: E2eSeededTenant = {
        id: tenantId,
        key: seeded.key,
        name: seeded.name,
        admin,
        members: seeded.members.map((member) => toUser(member, [ROLES.Member])),
        addUser: async (roles = [ROLES.Member]) =>
          toUser(
            await postSeedRoute(
              request,
              SEED_ROUTES.seedUser,
              { tenantId, roles: [...roles] } satisfies SeedUserRequest,
              seedUserResponseSchema,
            ),
            roles,
          ),
        api: httpApiFor(admin),
        apiAs: httpApiFor,
        loginAs,
      };

      for (const part of opts.with ?? []) await part({ tenant });
      return tenant;
    });

    await Promise.all(openedContexts.map((ctx) => ctx.dispose()));
  },
});
