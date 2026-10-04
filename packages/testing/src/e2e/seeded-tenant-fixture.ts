import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import {
  type APIRequestContext,
  type BrowserContext,
  test as base,
  type Page,
  type Request as PlaywrightRequest,
  type PlaywrightTestArgs,
  type PlaywrightTestOptions,
  type PlaywrightWorkerArgs,
  type TestInfo,
} from "@playwright/test";
import type * as z from "zod";
import {
  type BoundApi,
  type SeedAdminIdentity,
  type SeededCredentials,
  type SeededTenant,
  type SeededUser,
  type SeedTenantOptions,
  withSession,
} from "../seed-types";
import {
  CLIENT_IP_HEADER,
  clearSession,
  createHttpApi,
  enrollTotpViaApi,
  loginEnrollingIfRequired,
  loginViaApi,
  syntheticClientIpFor,
} from "./auth-kit";
import { SEED_ROUTES, SEED_TOKEN_ENV } from "./constants";
import { seedRouteHeaders } from "./mail-capture";
import {
  type ExtraSeedRequest,
  extraSeedResponseSchema,
  type SeedUserRequest,
  seedTenantResponseSchema,
  seedUserResponseSchema,
} from "./seed-contract";

export type E2eSeedTenantOptions = Omit<SeedTenantOptions, "persist"> & {
  // Enrolls the admin with a confirmed TOTP factor (needed when the app
  // enforces MFA); the secret comes back as `admin.mfaTotpSecret`.
  readonly mfa?: "totp";
};

export type E2eSeedUserIdentity = SeedAdminIdentity & {
  // Enrolls the new user with a confirmed TOTP factor; the secret comes back as `mfaTotpSecret`.
  readonly mfa?: "totp";
};

export type E2eSeededTenant = Omit<SeededTenant, "addUser"> & {
  readonly addUser: (
    roles?: readonly string[],
    identity?: E2eSeedUserIdentity,
  ) => Promise<SeededUser>;
  readonly loginAs: (page: Page, user: SeededUser) => Promise<void>;
  // Runs an app seeder registered via createE2eSeedRoutes({ extraSeeders })
  // inside this tenant and resolves to its JSON result, unvalidated.
  readonly seed: (seeder: string, body?: unknown) => Promise<unknown>;
};

/**
 * Seeds a tenant over HTTP and logs the shared `context` in as its admin, so
 * a `page` opened from that context is already authenticated — call
 * `loginAs` to switch it to another seeded user instead.
 */
export type SeedTenantFixture = (opts?: E2eSeedTenantOptions) => Promise<E2eSeededTenant>;

type E2eFixtures = {
  seedTenant: SeedTenantFixture;
};

// Narrowed to the four fixtures the body below actually reads, so a unit
// test can drive it with plain stubs instead of a full Playwright run.
export type ProvideSeedTenantDeps = Pick<
  PlaywrightTestArgs & PlaywrightWorkerArgs,
  "request" | "context" | "playwright"
> &
  Pick<PlaywrightTestOptions, "baseURL">;

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

export async function provideSeedTenant(
  { request, context, playwright, baseURL }: ProvideSeedTenantDeps,
  use: (fixture: SeedTenantFixture) => Promise<void>,
): Promise<void> {
  const openedContexts: APIRequestContext[] = [];
  const apiByUserId = new Map<string, BoundApi>();

  // One cookie jar per user: two tenants (or admin + member) in one test must not clobber each other's session.
  const openLoggedInApi = async (user: SeededUser): Promise<BoundApi> => {
    const ctx = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { [CLIENT_IP_HEADER]: syntheticClientIpFor(user.email) },
    });
    openedContexts.push(ctx);
    await loginViaApi(ctx, user);
    return createHttpApi(ctx);
  };

  const httpApiFor = (user: SeededUser): BoundApi => {
    const cached = apiByUserId.get(user.id);
    if (cached !== undefined) return cached;
    let opened: Promise<BoundApi> | undefined;
    const bound = (): Promise<BoundApi> => {
      // A rejected login must not stay cached, or every later call replays the same stale error.
      opened ??= openLoggedInApi(user).catch((error: unknown) => {
        opened = undefined;
        throw error;
      });
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
    await clearSession(page);
    await loginViaApi(page.context().request, user);
  };

  await use(async (opts = {}) => {
    if (baseURL === undefined) {
      throw new Error("seedTenant: the Playwright config has no baseURL");
    }
    const seeded = await postSeedRoute(
      request,
      SEED_ROUTES.seedTenant,
      { name: opts.name, members: opts.users, admin: opts.admin },
      seedTenantResponseSchema,
    );
    const tenantId = seeded.id;
    const toUser = (credentials: SeededCredentials, roles: readonly string[]): SeededUser =>
      withSession(credentials, tenantId, roles);

    const adminRow = toUser(seeded.admin, [ROLES.TenantAdmin]);
    // Without the option, a policy that demands MFA still gets the admin enrolled
    // (the login answers with a required setup); mfa: "totp" forces it without one.
    const adminSecret =
      opts.mfa === "totp"
        ? await enrollTotpViaApi(context.request, adminRow)
        : await loginEnrollingIfRequired(context.request, adminRow);
    const admin =
      adminSecret === undefined ? adminRow : { ...adminRow, mfaTotpSecret: adminSecret };

    const tenant: E2eSeededTenant = {
      id: tenantId,
      key: seeded.key,
      name: seeded.name,
      admin,
      members: seeded.members.map((member) => toUser(member, [ROLES.Member])),
      addUser: async (roles = [ROLES.Member], identity = {}) => {
        const user = toUser(
          await postSeedRoute(
            request,
            SEED_ROUTES.seedUser,
            {
              tenantId,
              roles: [...roles],
              displayName: identity.displayName,
              email: identity.email,
            } satisfies SeedUserRequest,
            seedUserResponseSchema,
          ),
          roles,
        );
        if (identity.mfa !== "totp") return user;
        // Enrollment logs its context in; a throwaway one keeps the admin's session intact.
        const enrollContext = await playwright.request.newContext({
          baseURL,
          extraHTTPHeaders: { [CLIENT_IP_HEADER]: syntheticClientIpFor(user.email) },
        });
        try {
          return { ...user, mfaTotpSecret: await enrollTotpViaApi(enrollContext, user) };
        } finally {
          await enrollContext.dispose();
        }
      },
      api: httpApiFor(admin),
      apiAs: httpApiFor,
      loginAs,
      seed: async (seeder, body) =>
        (
          await postSeedRoute(
            request,
            SEED_ROUTES.extraSeed,
            { tenantId, seeder, body } satisfies ExtraSeedRequest,
            extraSeedResponseSchema,
          )
        ).result,
    };

    for (const part of opts.with ?? []) await part({ tenant });
    return tenant;
  });

  await Promise.all(openedContexts.map((ctx) => ctx.dispose()));
}

// Every e2e client connects from ::1, and the e2e webServer trusts one proxy
// hop (defineAppE2eConfig). Without a distinct X-Forwarded-For per test, all
// browser pages of a run would share one `per: "ip"` rate-limit bucket and
// 429 under parallel load. The run token keeps a rerun within the limiter
// window out of the previous run's buckets; the retry index keeps a retry
// out of the bucket its failed attempt already drained.
export function perTestClientIpKey(
  testInfo: Pick<TestInfo, "testId" | "repeatEachIndex" | "retry">,
  runToken: string | undefined = process.env[SEED_TOKEN_ENV],
): string {
  return `${runToken ?? ""}:${testInfo.testId}:${testInfo.repeatEachIndex}:${testInfo.retry}`;
}

// Same-origin only: on a cross-origin fetch the extra header would force a
// CORS preflight the target never agreed to (why extraHTTPHeaders is no option
// here). An explicit X-Forwarded-For set by the test wins.
export function headersWithClientIp(
  request: { readonly url: string; readonly frameUrl: string | undefined },
  headers: Readonly<Record<string, string>>,
  clientIp: string,
): Record<string, string> | undefined {
  if (request.frameUrl === undefined) return undefined;
  let sameOrigin: boolean;
  try {
    sameOrigin = new URL(request.frameUrl).origin === new URL(request.url).origin;
  } catch {
    return undefined;
  }
  return sameOrigin ? { [CLIENT_IP_HEADER]: clientIp, ...headers } : undefined;
}

function frameUrlOf(request: PlaywrightRequest): string | undefined {
  try {
    return request.frame().url();
  } catch {
    // Service-worker requests have no frame.
    return undefined;
  }
}

export async function providePerTestClientIpContext(
  { context }: Pick<PlaywrightTestArgs, "context">,
  use: (context: BrowserContext) => Promise<void>,
  testInfo: Pick<TestInfo, "testId" | "repeatEachIndex" | "retry">,
): Promise<void> {
  const clientIp = syntheticClientIpFor(perTestClientIpKey(testInfo));
  await context.route("**/api/**", (route) => {
    const request = route.request();
    const headers = headersWithClientIp(
      { url: request.url(), frameUrl: frameUrlOf(request) },
      request.headers(),
      clientIp,
    );
    return headers === undefined ? route.fallback() : route.fallback({ headers });
  });
  await use(context);
}

export const test = base.extend<E2eFixtures>({
  context: providePerTestClientIpContext,
  seedTenant: provideSeedTenant,
});
