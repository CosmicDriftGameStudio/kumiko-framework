import type { AppContext, ContextServices } from "../engine/types/index.ts";

type ServiceKey = Exclude<keyof ContextServices, "extensions">;
type AppContextKey = Exclude<keyof AppContext, "services">;

// Every AppContext key is either a service a handler or job may use, or boot wiring the framework
// consumes itself. The satisfies clause makes a new AppContext key a compile error until it is classified.
export const APP_CONTEXT_KEY_ROLES = {
  redis: "service",
  cacheSync: "service",
  jobRunner: "service",
  searchAdapter: "service",
  entityCache: "service",
  secrets: "service",
  kms: "service",
  files: "service",
  derivatives: "service",
  configResolver: "service",
  configEncryption: "service",
  rateLimit: "service",
  effectiveFeatures: "service",
  masterKeyProvider: "service",
  _fileProviderResolver: "service",
  _notifyFactory: "service",
  _notifyInTransactionFactory: "service",
  _notifyAfterCommitFactory: "service",
  _escapeHatchAuditSink: "service",
  db: "wiring",
  systemDb: "wiring",
  registry: "wiring",
  systemUser: "wiring",
  log: "wiring",
  triggeredBy: "wiring",
  triggerName: "wiring",
  geoTzProvider: "wiring",
  clock: "wiring",
  _tenantId: "wiring",
  defaultLocale: "wiring",
  configAccessorFactory: "wiring",
  _rateLimitPayloadDigest: "wiring",
  tracer: "wiring",
  meter: "wiring",
  config: "wiring",
  configFor: "wiring",
  forTenant: "wiring",
  notify: "wiring",
  signal: "wiring",
  scheduleAfterCommit: "wiring",
  scheduleAfterRollback: "wiring",
} as const satisfies Record<AppContextKey, "service" | "wiring">;

type ServiceRoleKey = {
  [Key in keyof typeof APP_CONTEXT_KEY_ROLES]: (typeof APP_CONTEXT_KEY_ROLES)[Key] extends "service"
    ? Key
    : never;
}[keyof typeof APP_CONTEXT_KEY_ROLES];

type IsSame<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;
type MustBeTrue<Value extends true> = Value;

// A service mislabelled as wiring would satisfy the record above and silently vanish from ctx.services.
export type ServiceRolesMatchContextServices = MustBeTrue<IsSame<ServiceRoleKey, ServiceKey>>;

export type ContextServiceOverrides = { -readonly [Key in ServiceKey]?: ContextServices[Key] };

function isAppContextKey(key: string): key is AppContextKey {
  return Object.hasOwn(APP_CONTEXT_KEY_ROLES, key);
}

function isServiceKey(key: string): key is ServiceKey {
  return isAppContextKey(key) && APP_CONTEXT_KEY_ROLES[key] === "service";
}

// The dispatcher binds these two to one call's transaction; a factory inherited from an outer
// context must not leak into a context that has none of its own.
const PER_CALL_FACTORY_KEYS: ReadonlySet<ServiceKey> = new Set([
  "_notifyInTransactionFactory",
  "_notifyAfterCommitFactory",
]);

function copyService<Key extends ServiceKey>(
  target: ContextServiceOverrides,
  source: ContextServiceOverrides,
  key: Key,
): void {
  const value = source[key];
  if (value !== undefined) target[key] = value;
}

const SERVICE_KEYS: readonly ServiceKey[] = Object.keys(APP_CONTEXT_KEY_ROLES).filter(isServiceKey);

export function buildContextServices(
  context: AppContext,
  overrides: ContextServiceOverrides = {},
): ContextServices {
  const services: ContextServiceOverrides = {};
  for (const key of SERVICE_KEYS) {
    if (!PER_CALL_FACTORY_KEYS.has(key)) copyService(services, context, key);
    copyService(services, overrides, key);
  }
  const extensions = Object.fromEntries(
    Object.entries(context).filter(([key]) => key !== "services" && !isAppContextKey(key)),
  );
  return { ...services, extensions };
}
