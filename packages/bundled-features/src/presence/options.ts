export const PRESENCE_DEFAULT_ROLES: readonly string[] = ["TenantAdmin", "TenantMember"];
export const PRESENCE_DEFAULT_TTL_SECONDS = 45;

export type PresenceOptions = {
  /** Entities whose rows may carry presence. Default none: a heartbeat for an entity that is not
   *  listed is rejected. */
  readonly entities?: readonly string[];
  /** Roles allowed to send heartbeats and read presence. Default TenantAdmin and TenantMember. */
  readonly roles?: readonly string[];
  /** Seconds a user stays listed without a heartbeat. Default 45 (three missed 15 s beats). */
  readonly ttlSeconds?: number;
};

export type PresenceSettings = {
  readonly entities: ReadonlySet<string>;
  readonly roles: readonly string[];
  readonly ttlMs: number;
};

export function resolvePresenceSettings(options: PresenceOptions): PresenceSettings {
  const ttlSeconds = options.ttlSeconds ?? PRESENCE_DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error(`presence: ttlSeconds must be a positive number, got ${ttlSeconds}`);
  }
  return {
    entities: new Set(options.entities ?? []),
    roles: options.roles ?? PRESENCE_DEFAULT_ROLES,
    ttlMs: ttlSeconds * 1000,
  };
}
