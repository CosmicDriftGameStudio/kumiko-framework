import type { SseBroker } from "@kumiko/framework/api";
import type { DbConnection, DbRow } from "@kumiko/framework/db";
import { createTenantDb } from "@kumiko/framework/db";
import type { NotifyPriority, Registry, TenantId } from "@kumiko/framework/engine";
import { createSystemUser } from "@kumiko/framework/engine";
import { append } from "@kumiko/framework/event-store";
import { runProjectionsForEvent } from "@kumiko/framework/pipeline";
import { bridgeStub } from "@kumiko/framework/testing/handler-context";
import { generateId } from "@kumiko/framework/utils";
import { and, eq, or } from "drizzle-orm";
import type { Redis } from "ioredis";
import { DELIVERY_ATTEMPT_EVENT } from "./constants";
import { deliveryAttemptSchema } from "./events";
import { notificationPreferencesTable } from "./tables";
import type {
  ChannelContext,
  ChannelMessage,
  DeliveryChannel,
  DeliveryLogEntry,
  DeliveryService,
  NotificationRenderer,
} from "./types";

export type RateLimitConfig = {
  readonly redis: Redis;
  readonly maxPerHour: number; // per channel per tenant
  readonly keyPrefix?: string;
};

export type KillSwitchResolver = (tenantId: TenantId, channelName: string) => Promise<boolean>;

export type DeliveryServiceOptions = {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly sseBroker?: SseBroker;
  readonly channels: readonly DeliveryChannel[];
  readonly tenantUserIdsQuery?: string;
  readonly rateLimit?: RateLimitConfig;
  readonly isChannelKilled?: KillSwitchResolver; // returns true if channel is disabled for tenant
  // Redis handle used for idempotencyKey dedup. Falls back to rateLimit.redis.
  // Must be present whenever callers rely on idempotencyKey, otherwise notify()
  // throws at the callsite (silent no-op would be a correctness bug).
  readonly idempotencyRedis?: Redis;
};

// Build channel list from registry extension usages
export function collectChannels(registry: Registry): DeliveryChannel[] {
  const usages = registry.getExtensionUsages("deliveryChannel");
  return usages.map((usage) => {
    // @cast-boundary engine-payload — extension-usage carries unknown options
    const opts = usage.options as {
      resolve: DeliveryChannel["resolve"];
      send: DeliveryChannel["send"];
    };
    return { name: usage.entityName, resolve: opts.resolve, send: opts.send };
  });
}

// Build renderer map from registry extension usages
export function collectRenderers(registry: Registry): Map<string, NotificationRenderer> {
  const usages = registry.getExtensionUsages("notificationRenderer");
  const map = new Map<string, NotificationRenderer>();
  for (const usage of usages) {
    // @cast-boundary engine-payload — extension-usage carries unknown options
    const opts = usage.options as { render: NotificationRenderer["render"] };
    map.set(usage.entityName, { name: usage.entityName, render: opts.render });
  }
  return map;
}

export function createDeliveryService(options: DeliveryServiceOptions): DeliveryService {
  const {
    db,
    registry,
    sseBroker,
    channels,
    tenantUserIdsQuery,
    rateLimit,
    isChannelKilled,
    idempotencyRedis,
  } = options;
  const idemRedis = idempotencyRedis ?? rateLimit?.redis;

  // Rate limit check: atomic INCR + TTL + over-limit rollback via server-side
  // Lua. Runs single-threaded in Redis, so two parallel clients can't both
  // observe `count <= max` and slip past. The prior non-atomic JS version
  // could leave the counter stuck below the true hit count when two INCRs
  // raced into simultaneous DECR rollbacks.
  const RATE_LIMIT_LUA = `
    local count = redis.call('INCR', KEYS[1])
    if count == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    if count > tonumber(ARGV[2]) then
      redis.call('DECR', KEYS[1])
      return 0
    end
    return 1
  `;

  type RedisWithLua = Redis & {
    deliveryRateLimitCheck: (key: string, ttl: string, max: string) => Promise<number>;
  };

  if (rateLimit) {
    // Register the Lua script once per Redis client. Noop if already defined.
    // @cast-boundary engine-bridge — defineCommand attaches the Lua method post-boot
    const r = rateLimit.redis as Partial<Pick<RedisWithLua, "deliveryRateLimitCheck">> & Redis;
    if (!r.deliveryRateLimitCheck) {
      r.defineCommand("deliveryRateLimitCheck", { numberOfKeys: 1, lua: RATE_LIMIT_LUA });
    }
  }

  async function checkRateLimit(
    rl: RateLimitConfig,
    tenantId: TenantId,
    channelName: string,
  ): Promise<boolean> {
    const key = `${rl.keyPrefix ?? "delivery:rate"}:${tenantId}:${channelName}`;
    // @cast-boundary engine-bridge — defineCommand attaches the Lua method shape at boot
    const r = rl.redis as RedisWithLua;
    const allowed = await r.deliveryRateLimitCheck(key, "3600", String(rl.maxPerHour));
    return Number(allowed) === 1;
  }

  // Idempotency: returns true the first time a key is seen, false on
  // subsequent calls within the TTL window. Opt-in via options.idempotencyKey
  // so callers decide when dedup matters (e.g. webhook replays, button
  // double-clicks). Requires a Redis handle — configured via idempotencyRedis
  // or reused from rateLimit.redis. notify() throws if the key is used without
  // a backing Redis, so misconfigurations fail loud instead of silently double-sending.
  async function claimIdempotency(
    tenantId: TenantId,
    key: string,
    ttlSec = 86400,
  ): Promise<boolean> {
    if (!idemRedis) {
      throw new Error(
        "Delivery idempotencyKey requires options.idempotencyRedis (or rateLimit.redis) to be configured",
      );
    }
    const k = `delivery:idem:${tenantId}:${key}`;
    const res = await idemRedis.set(k, "1", "EX", ttlSec, "NX");
    return res === "OK";
  }

  async function resolveUserIdsForTenant(tenantId: TenantId): Promise<readonly string[]> {
    if (!tenantUserIdsQuery) {
      throw new Error("Tenant broadcast requires tenantUserIdsQuery in DeliveryServiceOptions");
    }
    const handler = registry.getQueryHandler(tenantUserIdsQuery);
    if (!handler) {
      throw new Error(`Tenant broadcast query "${tenantUserIdsQuery}" not found in registry`);
    }
    const systemUser = createSystemUser(tenantId);
    const tenantDb = createTenantDb(db, tenantId, "system");
    // @cast-boundary engine-payload — generic query-handler return for typed convention
    return (await handler.handler(
      { type: tenantUserIdsQuery, payload: { tenantId }, user: systemUser },
      { db: tenantDb, registry, ...bridgeStub() },
    )) as readonly string[];
  }

  function buildChannelContext(tenantId: TenantId): ChannelContext {
    return { db, registry, sseBroker, tenantId };
  }

  async function logDelivery(entry: DeliveryLogEntry): Promise<void> {
    // Post-ES: each delivery attempt is a standalone event on its own
    // aggregate stream (fresh UUID per attempt). The `delivery-log` inline
    // projection materialises the same row shape into deliveryAttemptsTable.
    // Low-level append() does NOT auto-fire inline projections (only the
    // dispatcher / executor / ctx.appendEvent paths do), so we invoke
    // runProjectionsForEvent manually to keep the write synchronous with
    // the projection update — same TX, read-your-own-write semantics.
    const attemptId = generateId();
    const { tenantId, ...rest } = entry;
    // Schema-parse to match ctx.appendEvent's guarantee: a payload drift
    // between service + feature-registration fails loudly here instead of
    // landing on the events-table and crashing a consumer later.
    const payload = deliveryAttemptSchema.parse(rest);
    const stored = await append(db, {
      aggregateId: attemptId,
      aggregateType: "deliveryAttempt",
      tenantId,
      expectedVersion: 0,
      type: DELIVERY_ATTEMPT_EVENT,
      payload,
      metadata: { userId: "system" },
    });
    await runProjectionsForEvent(stored, registry, db);
  }

  function buildMessage(
    notificationType: string,
    data: Readonly<Record<string, unknown>> | undefined,
    channelName: string,
  ): ChannelMessage {
    // Look up per-channel template from notification definition
    const notifDef = registry.getAllNotifications().get(notificationType);
    const templateFn = notifDef?.templates?.[channelName];

    if (templateFn && data) {
      const channelData = templateFn(data as DbRow);
      // @cast-boundary engine-payload — generic notification.data + channel-template result
      return {
        notificationType,
        title: (channelData["title"] as string) ?? (data["title"] as string) ?? notificationType,
        body: channelData["body"] as string | undefined,
        data: channelData,
      };
    }

    // @cast-boundary engine-payload — generic notification.data shape
    return {
      notificationType,
      title: (data?.["title"] as string) ?? notificationType,
      body: data?.["body"] as string | undefined,
      data,
    };
  }

  // Check if user has disabled this notification+channel combo.
  // Specificity order: exact > any wildcard. When only wildcards match and they
  // disagree, "disabled wins" — the user has asked to be opted out somewhere,
  // and an exact override is the way to punch through it. Without this rule
  // the outcome would depend on row insertion order in the DB.
  // Example:
  //   { type: "*", channel: "inApp", enabled: false }         disables inApp globally
  //   { type: "orderAssigned", channel: "*", enabled: true }  enables orderAssigned everywhere
  //   → orderAssigned on inApp: disabled (conservative) unless an exact entry overrides.
  async function isChannelEnabled(
    userId: string,
    tenantId: TenantId,
    notificationType: string,
    channelName: string,
  ): Promise<boolean> {
    type PrefRow = {
      readonly notificationType: string;
      readonly channel: string;
      readonly enabled: boolean;
    };
    // Drizzle's dynamic-table select() loses column types; assert once at
    // the boundary so the rest of this function works against a typed shape.
    const prefs = (await db
      .select({
        notificationType: notificationPreferencesTable.notificationType,
        channel: notificationPreferencesTable.channel,
        enabled: notificationPreferencesTable.enabled,
      })
      .from(notificationPreferencesTable)
      .where(
        and(
          eq(notificationPreferencesTable.tenantId, tenantId),
          eq(notificationPreferencesTable.userId, userId),
          or(
            and(
              eq(notificationPreferencesTable.notificationType, notificationType),
              eq(notificationPreferencesTable.channel, channelName),
            ),
            and(
              eq(notificationPreferencesTable.notificationType, "*"),
              eq(notificationPreferencesTable.channel, channelName),
            ),
            and(
              eq(notificationPreferencesTable.notificationType, notificationType),
              eq(notificationPreferencesTable.channel, "*"),
            ),
          ),
        ),
      )) as readonly PrefRow[]; // @cast-boundary db-row

    if (prefs.length === 0) return true;

    // Exact match (both specific) wins over any wildcard
    const exact = prefs.find(
      (p) => p.notificationType === notificationType && p.channel === channelName,
    );
    if (exact) return exact.enabled;

    // Only wildcards matched: any disabled entry disables delivery (deterministic
    // and conservative — DB ordering no longer decides the outcome).
    return !prefs.some((p) => p.enabled === false);
  }

  async function deliverToUser(
    userId: string,
    notificationType: string,
    data: Readonly<Record<string, unknown>> | undefined,
    tenantId: TenantId,
    priority: NotifyPriority,
  ): Promise<void> {
    const channelCtx = buildChannelContext(tenantId);

    for (const channel of channels) {
      const message = buildMessage(notificationType, data, channel.name);

      // Kill switch: tenant admin disabled this channel entirely
      if (isChannelKilled) {
        const killed = await isChannelKilled(tenantId, channel.name);
        if (killed) {
          await logDelivery({
            tenantId,
            notificationType,
            channel: channel.name,
            recipientId: userId,
            recipientAddress: null,
            status: "skipped",
            error: "channel_disabled",
          });
          continue;
        }
      }

      // Check preferences (critical priority skips preference check)
      if (priority !== "critical") {
        const enabled = await isChannelEnabled(userId, tenantId, notificationType, channel.name);
        if (!enabled) {
          await logDelivery({
            tenantId,
            notificationType,
            channel: channel.name,
            recipientId: userId,
            recipientAddress: null,
            status: "skipped",
            error: "preference_disabled",
          });
          continue;
        }
      }

      // Rate limiting
      if (rateLimit) {
        const allowed = await checkRateLimit(rateLimit, tenantId, channel.name);
        if (!allowed) {
          await logDelivery({
            tenantId,
            notificationType,
            channel: channel.name,
            recipientId: userId,
            recipientAddress: null,
            status: "skipped",
            error: "rate_limited",
          });
          continue;
        }
      }

      try {
        const address = await channel.resolve(userId, channelCtx);
        if (!address) {
          await logDelivery({
            tenantId,
            notificationType,
            channel: channel.name,
            recipientId: userId,
            recipientAddress: null,
            status: "skipped",
            error: "no_address",
          });
          continue;
        }

        const result = await channel.send(address, message, channelCtx);
        await logDelivery({
          tenantId,
          notificationType,
          channel: channel.name,
          recipientId: userId,
          recipientAddress: result.address ?? address,
          status: result.status,
          error: result.error ?? null,
        });
      } catch (err) {
        await logDelivery({
          tenantId,
          notificationType,
          channel: channel.name,
          recipientId: userId,
          recipientAddress: null,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async function deliverDirect(
    route: Readonly<Record<string, string>>,
    notificationType: string,
    data: Readonly<Record<string, unknown>> | undefined,
    tenantId: TenantId,
  ): Promise<void> {
    const channelCtx = buildChannelContext(tenantId);

    // Direct routing skips preferences (no user account) but NOT rate limit
    // — direct sends can still be abused (webhook replays, test harnesses).
    for (const channel of channels) {
      const address = route[channel.name];
      const message = buildMessage(notificationType, data, channel.name);
      if (!address) continue;

      if (rateLimit) {
        const allowed = await checkRateLimit(rateLimit, tenantId, channel.name);
        if (!allowed) {
          await logDelivery({
            tenantId,
            notificationType,
            channel: channel.name,
            recipientId: null,
            recipientAddress: address,
            status: "skipped",
            error: "rate_limited",
          });
          continue;
        }
      }

      try {
        const result = await channel.send(address, message, channelCtx);
        await logDelivery({
          tenantId,
          notificationType,
          channel: channel.name,
          recipientId: null,
          recipientAddress: result.address ?? address,
          status: result.status,
          error: result.error ?? null,
        });
      } catch (err) {
        await logDelivery({
          tenantId,
          notificationType,
          channel: channel.name,
          recipientId: null,
          recipientAddress: address,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return {
    async notify(notificationType, options, _user, tenantId) {
      const { to, route, data, idempotencyKey } = options;
      const priority: NotifyPriority = options.priority ?? "normal";

      if (idempotencyKey) {
        const first = await claimIdempotency(tenantId, idempotencyKey);
        if (!first) {
          await logDelivery({
            tenantId,
            notificationType,
            channel: "*",
            recipientId: null,
            recipientAddress: null,
            status: "skipped",
            error: "duplicate_idempotency_key",
          });
          // skip: duplicate send deduped via idempotency key, logged above
          return;
        }
      }

      if (route) {
        await deliverDirect(route, notificationType, data, tenantId);
        // skip: direct route delivered, no recipient resolution needed
        return;
      }

      if (to !== undefined) {
        let userIds: readonly string[];

        if (typeof to === "string") {
          userIds = [to];
        } else if ("tenant" in to) {
          userIds = await resolveUserIdsForTenant(to.tenant);
        } else {
          userIds = to;
        }

        for (const userId of userIds) {
          await deliverToUser(userId, notificationType, data, tenantId, priority);
        }
      }
    },
  };
}
