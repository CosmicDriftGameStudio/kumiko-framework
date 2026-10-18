import {
  type SeedAdminOptions,
  seedAdminGuarded,
  seedTenant,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/seeding";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { parseTenantId, type TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import type { ProdSeedFn } from "../run-prod-app.js";

export type ProdSeedTenant = {
  /** Default: `DEMO_TENANT_ID` from the env. */
  readonly id?: string;
  readonly key: string;
  readonly name: string;
};

type SeededAccountOptions = {
  readonly displayName?: string;
  /** Membership roles in the tenant. */
  readonly roles?: readonly string[];
  readonly emailVerified?: boolean;
};

/** Declarative boot seeds, all idempotent (existing users keep their roles).
 *  Need `auth`; run right after `auth.admin`, before `run`.
 *  - `demoTenant`: the tenant the demo accounts belong to.
 *  - `demoAdminFromEnv`: `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD`, member of
 *    `demoTenant` with `Admin` + `TenantAdmin` (default). Replaces `auth.admin`.
 *  - `sysadminFromEnv`: `DEMO_SYSADMIN_EMAIL` / `DEMO_SYSADMIN_PASSWORD`, global
 *    role `SystemAdmin`, email verified, member of `tenant` (default
 *    `demoTenant`) with role `User` (default).
 *  - `run`: free seed functions, same contract as the array form.
 *
 *  @example
 *  seeds: {
 *    demoTenant: { key: "demo", name: "Demo" },
 *    demoAdminFromEnv: true,
 *    sysadminFromEnv: true,
 *    run: [seedDemoData],
 *  }
 */
export type ProdSeedsConfig = {
  readonly demoTenant?: ProdSeedTenant;
  readonly demoAdminFromEnv?: boolean | SeededAccountOptions;
  readonly sysadminFromEnv?:
    | boolean
    | (SeededAccountOptions & { readonly tenant?: ProdSeedTenant });
  readonly run?: readonly ProdSeedFn[];
};

export type DbSeedFn = (db: DbConnection) => Promise<void>;

const DEFAULT_DEMO_ADMIN_ROLES = ["Admin", ROLES.TenantAdmin] as const;
const DEFAULT_SYSADMIN_TENANT_ROLES = ["User"] as const;

type ResolvedTenant = { readonly id: TenantId; readonly key: string; readonly name: string };

function resolveTenant(
  tenant: ProdSeedTenant,
  envSource: Record<string, string | undefined>,
  label: string,
): ResolvedTenant {
  const rawId = tenant.id ?? envSource["DEMO_TENANT_ID"];
  const id = parseTenantId(rawId);
  if (id === null) {
    throw new Error(
      `[runProdApp] seeds.${label} needs a UUID id (option or DEMO_TENANT_ID), got ${rawId === undefined ? "nothing" : "an invalid value"}.`,
    );
  }
  return { id, key: tenant.key, name: tenant.name };
}

function requireAccountEnv(
  envSource: Record<string, string | undefined>,
  emailKey: string,
  passwordKey: string,
  label: string,
): { readonly email: string; readonly password: string } {
  const email = envSource[emailKey];
  const password = envSource[passwordKey];
  if (!email || !password) {
    const missing = [emailKey, passwordKey].filter((key) => !envSource[key]);
    throw new Error(`[runProdApp] seeds.${label} is missing ${missing.join(", ")}.`);
  }
  return { email, password };
}

function accountOptions(value: boolean | SeededAccountOptions): SeededAccountOptions {
  return typeof value === "object" ? value : {};
}

function membershipOf(tenant: ResolvedTenant, roles: readonly string[]) {
  return { tenantId: tenant.id, tenantKey: tenant.key, tenantName: tenant.name, roles };
}

function seedAccount(admin: SeedAdminOptions): DbSeedFn {
  return async (db) => {
    await seedAdminGuarded(db, admin);
  };
}

function buildDemoAdminSeed(
  value: boolean | SeededAccountOptions,
  demoTenant: ResolvedTenant | undefined,
  envSource: Record<string, string | undefined>,
): DbSeedFn {
  if (!demoTenant) {
    throw new Error("[runProdApp] seeds.demoAdminFromEnv needs seeds.demoTenant.");
  }
  const options = accountOptions(value);
  const account = requireAccountEnv(
    envSource,
    "DEMO_ADMIN_EMAIL",
    "DEMO_ADMIN_PASSWORD",
    "demoAdminFromEnv",
  );
  return seedAccount({
    ...account,
    displayName: options.displayName ?? "Admin",
    memberships: [membershipOf(demoTenant, options.roles ?? DEFAULT_DEMO_ADMIN_ROLES)],
    ...(options.emailVerified !== undefined && { emailVerified: options.emailVerified }),
  });
}

function buildSysadminSeed(
  value: NonNullable<ProdSeedsConfig["sysadminFromEnv"]>,
  demoTenant: ResolvedTenant | undefined,
  envSource: Record<string, string | undefined>,
): DbSeedFn {
  const options = typeof value === "object" ? value : {};
  const tenant = options.tenant
    ? resolveTenant(options.tenant, envSource, "sysadminFromEnv.tenant")
    : demoTenant;
  if (!tenant) {
    throw new Error(
      "[runProdApp] seeds.sysadminFromEnv needs seeds.demoTenant or sysadminFromEnv.tenant for its login membership.",
    );
  }
  const account = requireAccountEnv(
    envSource,
    "DEMO_SYSADMIN_EMAIL",
    "DEMO_SYSADMIN_PASSWORD",
    "sysadminFromEnv",
  );
  // Verified by default: with strict verification an undelivered mail would
  // otherwise lock out the only SystemAdmin.
  return seedAccount({
    ...account,
    displayName: options.displayName ?? "Sysadmin",
    globalRoles: [ROLES.SystemAdmin],
    emailVerified: options.emailVerified ?? true,
    memberships: [membershipOf(tenant, options.roles ?? DEFAULT_SYSADMIN_TENANT_ROLES)],
  });
}

/** Validates env and options at boot (before any connection) and returns the
 *  seeds to run once the database is up. */
export function resolveSeedShortcuts(
  seeds: ProdSeedsConfig,
  deps: {
    readonly envSource: Record<string, string | undefined>;
    readonly hasAuth: boolean;
    readonly hasAuthAdmin: boolean;
  },
): readonly DbSeedFn[] {
  const wantsAccounts = Boolean(seeds.demoAdminFromEnv) || Boolean(seeds.sysadminFromEnv);
  if ((wantsAccounts || seeds.demoTenant) && !deps.hasAuth) {
    throw new Error(
      "[runProdApp] seeds.demoTenant / demoAdminFromEnv / sysadminFromEnv need `auth` (user, tenant and auth-email-password features).",
    );
  }
  if (seeds.demoAdminFromEnv && deps.hasAuthAdmin) {
    throw new Error(
      "[runProdApp] seeds.demoAdminFromEnv and auth.admin both seed the admin — keep one.",
    );
  }
  const demoTenant = seeds.demoTenant
    ? resolveTenant(seeds.demoTenant, deps.envSource, "demoTenant")
    : undefined;
  const result: DbSeedFn[] = [];
  if (demoTenant) {
    result.push(async (db) => {
      await seedTenant(db, demoTenant);
    });
  }
  if (seeds.demoAdminFromEnv) {
    result.push(buildDemoAdminSeed(seeds.demoAdminFromEnv, demoTenant, deps.envSource));
  }
  if (seeds.sysadminFromEnv) {
    result.push(buildSysadminSeed(seeds.sysadminFromEnv, demoTenant, deps.envSource));
  }
  return result;
}
