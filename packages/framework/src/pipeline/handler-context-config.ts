import type { ConfigAccessor } from "@cosmicdrift/kumiko-types/config";
import { createTenantDb, type TenantDb } from "../db/tenant-db.ts";
import { createSystemUser } from "../engine/system-user.ts";
import type { TenantId } from "../engine/types/identifiers.ts";

import { AccessDeniedError } from "../errors/index.ts";
import { DEFAULT_LOCALE, isValidLocaleTag } from "../i18n/request-locale.ts";
import { createTzContext, isValidIanaTimeZone } from "../time/index.ts";
import { configAccessorFactoryOf } from "./config-accessor-factory.ts";
import type { HandlerContextScope } from "./handler-context-scope.ts";
import { isSystemIdentity } from "./system-identity-switch.ts";
import { TENANT_TIMEZONE_CONFIG_KEY } from "./tenant-timezone-config-key.ts";

type ConfigFactory = NonNullable<ReturnType<typeof configAccessorFactoryOf>>;

// Cross-tenant accessor for SystemAdmin/system callers. The
// identity is the target tenant's system user so the caller's own user-scope
// values never resolve into another tenant's config; the db is tenant-mode
// scoped to the target.
function buildConfigFor(
  scope: HandlerContextScope,
  configFactory: ConfigFactory | undefined,
  config: ConfigAccessor | undefined,
) {
  const { user, context, registry, dbSource } = scope;
  return configFactory && dbSource
    ? (targetTenantId: TenantId): ConfigAccessor => {
        if (targetTenantId === user.tenantId && config) return config;
        if (!isSystemIdentity(user) && !user.roles.includes("SystemAdmin")) {
          throw new AccessDeniedError({
            message: "ctx.tenants.config(otherTenant) requires the system role or SystemAdmin",
            details: { reason: "config_for_requires_system_admin" },
          });
        }
        const targetSystemUser = createSystemUser(targetTenantId);
        return configFactory({
          user: { id: targetSystemUser.id, tenantId: targetTenantId },
          db: createTenantDb({
            db: dbSource,
            tenantId: targetTenantId,
            mode: "tenant",
            tracer: context.tracer,
            meter: context.meter,
            grants: { projectionRegistry: registry },
          }),
          secrets: context.secrets,
        });
      }
    : undefined;
}

export function buildConfigFacet(scope: HandlerContextScope, db: TenantDb | undefined) {
  const { user, context } = scope;
  // Mirror notify: only built when the config feature wired its factory.
  const configFactory = configAccessorFactoryOf(context);
  const config =
    configFactory && db
      ? configFactory({
          user: { id: user.id, tenantId: user.tenantId },
          db,
          secrets: context.secrets,
        })
      : undefined;
  const configFor = buildConfigFor(scope, configFactory, config);
  return { config, configFor };
}

async function readTenantTimezone(
  scope: HandlerContextScope,
  config: ConfigAccessor | undefined,
): Promise<unknown> {
  const { ctx, user, tx } = scope;
  if (config === undefined) return undefined;
  const cachedTz = ctx.tenantTimezoneCache.get(user.tenantId);
  if (cachedTz) return cachedTz.value;
  const generationAtRead = ctx.tenantTimezoneCache.generation();
  const tenantTz = await config(TENANT_TIMEZONE_CONFIG_KEY);
  if (tx === undefined) {
    ctx.tenantTimezoneCache.setIfFresh(
      user.tenantId,
      typeof tenantTz === "string" ? tenantTz : undefined,
      generationAtRead,
    );
  }
  return tenantTz;
}

// ctx.tz is always present. tenant reads tenant:config:timezone through
// the already-built `config` accessor (raw qualified-key — no import of
// the tenant feature, framework/pipeline stays bundled-features-free);
// falls back to "UTC" when config is missing or the key is unset. user
// comes from SessionUser.timezone (set at login), else falls back to
// tenant (createTzContext's own default). An app-injected GeoTzProvider
// (context.geoTzProvider) feeds ctx.tz.fromCoordinates / fromAddress.
//
// Resolving this via `config()` is a config-table SELECT on every single
// dispatch — ctx.tenantTimezoneCache memoizes it per tenant.
// dispatch-write.ts invalidates on config:write:set/reset for this key.
// Only populate from a tx-free read (tx === undefined): a write-path
// lookup runs inside the caller's own open transaction, and caching a
// value read there could memoize state from a write earlier in that same
// transaction before it's known to commit. Reads always consult the
// cache regardless of tx, since serving a slightly stale cached value on
// the write path is harmless (bounded by ttlMs) and avoids reintroducing
// the SELECT on the hot path this fix targets.
export async function resolveHandlerTz(
  scope: HandlerContextScope,
  config: ConfigAccessor | undefined,
): Promise<ReturnType<typeof createTzContext>> {
  const { user, context } = scope;
  const tenantTz = await readTenantTimezone(scope, config);
  // Guarded against garbage: an unvalidated string here (free-form config
  // key, legacy JWT claim predating validation) blows up every ctx.tz call
  // for the whole tenant with a RangeError. Fall back to UTC/tenant instead
  // of trusting the raw value.
  const safeTenantTz =
    typeof tenantTz === "string" && isValidIanaTimeZone(tenantTz) ? tenantTz : "UTC";
  const safeUserTz =
    user.timezone !== undefined && isValidIanaTimeZone(user.timezone) ? user.timezone : undefined;
  return createTzContext({
    ...(context.geoTzProvider !== undefined ? { geoTz: context.geoTzProvider } : {}),
    ...(context.clock !== undefined ? { clock: context.clock } : {}),
    tenant: safeTenantTz,
    ...(safeUserTz !== undefined && { user: safeUserTz }),
  });
}

// ctx.locale — request-layer signal (X-Locale header → Accept-Language,
// resolved once at the HTTP boundary by request-id-middleware.ts) wins;
// then SessionUser.locale (set at login — stale until re-login, same
// tradeoff as ctx.tz.user); falls back to the app's
// boot-configured defaultLocale, then DEFAULT_LOCALE. Mirrors ctx.tz's
// Request → Session → Boot-Default chain.
export function resolveHandlerLocale(scope: HandlerContextScope): string {
  const { user, reqCtx, context } = scope;
  const safeUserLocale =
    user.locale !== undefined && isValidLocaleTag(user.locale) ? user.locale : undefined;
  return reqCtx?.locale ?? safeUserLocale ?? context.defaultLocale ?? DEFAULT_LOCALE;
}
