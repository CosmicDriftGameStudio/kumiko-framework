import type { SseBroker } from "@cosmicdrift/kumiko-framework/api";
import type { DbConnection, DbRow } from "@cosmicdrift/kumiko-framework/db";
import { createSystemDbView, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import type {
  DeliveryErrorCode,
  DeliverySkipReason,
  EscapeHatchAuditSink,
  NotifyDelivery,
  NotifyJobDispatcher,
  NotifyPriority,
  Registry,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import { createFallbackLogger, type Logger } from "@cosmicdrift/kumiko-framework/logging";
import { createEscapeHatchReporter } from "@cosmicdrift/kumiko-framework/pipeline";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { bridgeStub } from "@cosmicdrift/kumiko-framework/testing/handler-context";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import type { Redis } from "ioredis";
import { redactErrorText } from "../shared/redact.js";
import { hashUnsubscribeAddress } from "./address-opt-out.js";
import { appendAttemptEvent, logAttempt } from "./attempt-log.js";
import { buildChannelContext } from "./channel-context.js";
import { DELIVERY_CHANNEL_EXTENSION, DeliveryJobs, deliveryPriorityRank } from "./constants.js";
import { isAddressOptedOut } from "./db/queries/address-opt-outs.js";
import { selectNotificationPreferences } from "./db/queries/preferences.js";
import {
  type ChannelContext,
  type ChannelMessage,
  type ChannelResult,
  type DeliveryChannel,
  type DeliveryLogEntry,
  type DeliveryService,
  isDeliveryChannelPlugin,
  type RenderedMessage,
} from "./types.js";

const SKIP = {
  channel_disabled: "channel_disabled",
  preference_disabled: "preference_disabled",
  rate_limited: "rate_limited",
  no_address: "no_address",
  unsubscribed: "unsubscribed",
  duplicate_idempotency_key: "duplicate_idempotency_key",
} as const satisfies Record<DeliverySkipReason, DeliverySkipReason>;

export function redactedMessageOf(err: unknown): string {
  return redactErrorText(err instanceof Error ? err.message : String(err));
}

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
  // Job dispatcher for async (queued-mode) channels: email/push/chat render+send
  // run in the delivery.render → delivery.send jobs. notify() may override it per
  // call. When neither is present, queued channels fall back to synchronous
  // inline delivery (job-less setups, unit tests).
  readonly jobRunner?: NotifyJobDispatcher;
  // Credentials source for inline-delivered chat channels (webhook URL / bot
  // token). Jobs get ctx.secrets from the job runner instead.
  readonly secrets?: SecretsContext;
  // Attributed escape-hatch audit for resolveUserIdsForTenant's ctx.systemDb —
  // absent means an unattributed warn log (see fallbackEscapeHatchReporter).
  readonly escapeHatchAuditSink?: EscapeHatchAuditSink;
  readonly log?: Logger;
};

// Build channel list from registry extension usages
export function collectChannels(registry: Registry): DeliveryChannel[] {
  const usages = registry.getExtensionUsages(DELIVERY_CHANNEL_EXTENSION);
  return usages.map((usage) => {
    if (!isDeliveryChannelPlugin(usage.options)) {
      throw new Error(
        `${DELIVERY_CHANNEL_EXTENSION} registration for "${usage.entityName}" has invalid options`,
      );
    }
    return { name: usage.entityName, ...usage.options };
  });
}

// `collectRenderers` entfernt 2026-05-19: notificationRenderer-Extension-Point
// wurde nie konsumiert (channel-email nimmt renderer als Konstruktor-Option,
// nicht aus Extension-Usages). Multi-Kind-Plugin-Pool lebt jetzt im
// `renderer-foundation`-Bundle via `collectRendererPlugins`.

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
    jobRunner,
    secrets,
    escapeHatchAuditSink,
    log,
  } = options;
  const idemRedis = idempotencyRedis ?? rateLimit?.redis;
  const logError = createFallbackLogger("delivery", log);

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
    const report = createEscapeHatchReporter({
      handler: tenantUserIdsQuery,
      tenantId,
      actor: systemUser.id,
      sink: escapeHatchAuditSink,
      log,
    });
    // ctx.db/dbOutsideTransaction are tenant-filtered even for a systemScope handler:
    // the dispatcher closes them off entirely there, so "system" mode would hand this
    // path a cross-tenant read the dispatcher never allows. Cross-tenant reach only
    // exists through the grant-carrying systemDb view below.
    const isSystem = registry.isHandlerSystemScoped(tenantUserIdsQuery);
    const tenantDb = createTenantDb(db, tenantId, "tenant", undefined, undefined, undefined, {
      report,
    });
    // The dispatcher grants a systemScope handler's ctx.systemDb.unsafeRaw() ungated —
    // the grant comes from the handler's own r.systemScope() registration, not from this
    // caller. Only the systemDb view's own source TenantDb carries the grant, so it
    // can't leak onto ctx.db.
    const systemDbSourceTenantDb = isSystem
      ? createTenantDb(db, tenantId, "system", undefined, undefined, undefined, {
          report,
          unsafeRaw: { reason: `r.systemScope() handler "${tenantUserIdsQuery}"` },
        })
      : undefined;
    // Hand-built context, not routed through the dispatcher — this needs both
    // db and dbOutsideTransaction wired directly.
    // @cast-boundary engine-payload — generic query-handler return for typed convention
    return (await handler.handler(
      { type: tenantUserIdsQuery, payload: { tenantId }, user: systemUser },
      {
        db: tenantDb,
        dbOutsideTransaction: tenantDb,
        systemDb: systemDbSourceTenantDb
          ? createSystemDbView(systemDbSourceTenantDb, undefined, report)
          : undefined,
        registry,
        ...bridgeStub(),
      },
    )) as readonly string[];
  }

  // State of one notify() call: collects the per-channel outcome returned to
  // the caller. Passed explicitly — the service itself is shared across calls.
  type NotifyRun = {
    readonly deliveries: NotifyDelivery[];
    readonly jobDispatcher: NotifyJobDispatcher | undefined;
    readonly locale: string | undefined;
  };

  function recordDelivery(
    run: NotifyRun,
    entry: DeliveryLogEntry,
    deliveryAttemptId: string,
  ): void {
    run.deliveries.push({
      channel: entry.channel,
      recipientId: entry.recipientId,
      status: entry.status,
      error: entry.error,
      deliveryAttemptId,
    });
  }

  // Single-shot terminal log (inline channels, skips, idempotency dups). Async
  // attempts instead append a queued event up front and a terminal event from
  // the send job — see deliverViaChannel + jobs.ts.
  async function logDelivery(run: NotifyRun, entry: DeliveryLogEntry): Promise<void> {
    const attemptId = await logAttempt(db, registry, entry);
    recordDelivery(run, entry, attemptId);
  }

  // The stored/returned error is only the code; the redacted message goes to the log.
  async function logInlineFailure(
    run: NotifyRun,
    args: {
      readonly channel: DeliveryChannel;
      readonly address: string;
      readonly tenantId: TenantId;
      readonly recipientId: string | null;
      readonly notificationType: string;
      readonly priority: NotifyPriority;
    },
    code: DeliveryErrorCode,
    err: unknown,
  ): Promise<void> {
    logError.error(`${args.channel.name} ${code}: ${redactedMessageOf(err)}`, {
      notificationType: args.notificationType,
      channel: args.channel.name,
    });
    await logDelivery(run, {
      tenantId: args.tenantId,
      notificationType: args.notificationType,
      channel: args.channel.name,
      recipientId: args.recipientId,
      recipientAddress: args.address,
      status: "failed",
      error: code,
      priority: args.priority,
    });
  }

  // Deliver one resolved (channel, address) pair. Inline channels (inApp) and
  // the no-job-runner fallback render + send synchronously and log the terminal
  // status. Queued channels (email/push) record a `queued` attempt up front and
  // hand off to the delivery.render (or delivery.send) job, which appends the
  // terminal event on the same attempt stream.
  async function deliverViaChannel(args: {
    run: NotifyRun;
    channel: DeliveryChannel;
    address: string;
    message: ChannelMessage;
    channelCtx: ChannelContext;
    tenantId: TenantId;
    recipientId: string | null;
    notificationType: string;
    priority: NotifyPriority;
  }): Promise<void> {
    const {
      run,
      channel,
      address,
      message,
      channelCtx,
      tenantId,
      recipientId,
      notificationType,
      priority,
    } = args;

    if (channel.mode === "queued" && run.jobDispatcher) {
      // Async hand-off: record the attempt as queued, then dispatch the
      // render/send job — the terminal sent/failed event is appended by the
      // job, not here.
      const deliveryAttemptId = generateId();
      const queuedEntry: DeliveryLogEntry = {
        tenantId,
        notificationType,
        channel: channel.name,
        recipientId,
        recipientAddress: address,
        status: "queued",
        error: null,
        priority,
      };
      await appendAttemptEvent(db, registry, deliveryAttemptId, queuedEntry);
      await run.jobDispatcher.dispatch(
        channel.render ? DeliveryJobs.render : DeliveryJobs.send,
        {
          channelName: channel.name,
          address,
          tenantId,
          recipientId,
          notificationType,
          deliveryAttemptId,
          priority,
          message,
        },
        { priority: deliveryPriorityRank[priority] },
      );
      recordDelivery(run, queuedEntry, deliveryAttemptId);
    } else {
      // Inline (inApp) or no-job-runner fallback: render + send synchronously.
      let rendered: RenderedMessage | undefined;
      if (channel.render) {
        try {
          rendered = await channel.render(message, channelCtx);
        } catch (err) {
          await logInlineFailure(run, args, "render_failed", err);
          return;
        }
      }
      let result: ChannelResult;
      try {
        result = await channel.send(address, message, channelCtx, rendered);
      } catch (err) {
        await logInlineFailure(run, args, "send_failed", err);
        return;
      }
      await logDelivery(run, {
        tenantId,
        notificationType,
        channel: channel.name,
        recipientId,
        recipientAddress: result.address ?? address,
        status: result.status,
        error: result.error ?? null,
        priority,
      });
    }
  }

  function buildMessage(
    notificationType: string,
    data: Readonly<Record<string, unknown>> | undefined,
    channelName: string,
    locale: string | undefined,
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
        locale,
      };
    }

    // @cast-boundary engine-payload — generic notification.data shape
    return {
      notificationType,
      title: (data?.["title"] as string) ?? notificationType,
      body: data?.["body"] as string | undefined,
      data,
      locale,
    };
  }

  // Shared by deliverToUser (resolved account address) and deliverDirect (a
  // route address with no user account) — same suppression rule either way:
  // no blind-index key configured means no hash, so nothing to look up.
  async function isAddressSuppressed(
    address: string,
    tenantId: TenantId,
    notificationType: string,
    channelName: string,
  ): Promise<boolean> {
    const addressHash = hashUnsubscribeAddress(address);
    if (addressHash === undefined) return false;
    return isAddressOptedOut(db, tenantId, addressHash, notificationType, channelName);
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
    const prefs = await selectNotificationPreferences(
      db,
      tenantId,
      userId,
      notificationType,
      channelName,
    );

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
    run: NotifyRun,
  ): Promise<void> {
    const channelCtx = buildChannelContext(db, registry, sseBroker, tenantId, secrets);

    for (const channel of channels) {
      // Route-only channel (no per-user address): not a user-notification target.
      if (!channel.resolve) continue;

      const message = buildMessage(notificationType, data, channel.name, run.locale);

      // Kill switch: tenant admin disabled this channel entirely
      if (isChannelKilled) {
        const killed = await isChannelKilled(tenantId, channel.name);
        if (killed) {
          await logDelivery(run, {
            tenantId,
            notificationType,
            channel: channel.name,
            recipientId: userId,
            recipientAddress: null,
            status: "skipped",
            error: SKIP.channel_disabled,
            priority,
          });
          continue;
        }
      }

      // Check preferences (critical priority skips preference check)
      if (priority !== "critical") {
        const enabled = await isChannelEnabled(userId, tenantId, notificationType, channel.name);
        if (!enabled) {
          await logDelivery(run, {
            tenantId,
            notificationType,
            channel: channel.name,
            recipientId: userId,
            recipientAddress: null,
            status: "skipped",
            error: SKIP.preference_disabled,
            priority,
          });
          continue;
        }
      }

      // Rate limiting
      if (rateLimit) {
        const allowed = await checkRateLimit(rateLimit, tenantId, channel.name);
        if (!allowed) {
          await logDelivery(run, {
            tenantId,
            notificationType,
            channel: channel.name,
            recipientId: userId,
            recipientAddress: null,
            status: "skipped",
            error: SKIP.rate_limited,
            priority,
          });
          continue;
        }
      }

      try {
        const address = await channel.resolve(userId, channelCtx);
        if (!address) {
          await logDelivery(run, {
            tenantId,
            notificationType,
            channel: channel.name,
            recipientId: userId,
            recipientAddress: null,
            status: "skipped",
            error: SKIP.no_address,
            priority,
          });
          continue;
        }

        if (
          priority !== "critical" &&
          (await isAddressSuppressed(address, tenantId, notificationType, channel.name))
        ) {
          await logDelivery(run, {
            tenantId,
            notificationType,
            channel: channel.name,
            recipientId: userId,
            recipientAddress: null,
            status: "skipped",
            error: SKIP.unsubscribed,
            priority,
          });
          continue;
        }

        await deliverViaChannel({
          run,
          channel,
          address,
          message,
          channelCtx,
          tenantId,
          recipientId: userId,
          notificationType,
          priority,
        });
      } catch (err) {
        logError.error(`${channel.name} channel_error: ${redactedMessageOf(err)}`, {
          notificationType,
          channel: channel.name,
        });
        await logDelivery(run, {
          tenantId,
          notificationType,
          channel: channel.name,
          recipientId: userId,
          recipientAddress: null,
          status: "failed",
          error: "channel_error",
          priority,
        });
      }
    }
  }

  async function deliverDirect(
    route: Readonly<Record<string, string>>,
    notificationType: string,
    data: Readonly<Record<string, unknown>> | undefined,
    tenantId: TenantId,
    priority: NotifyPriority,
    recipientId: string | null,
    run: NotifyRun,
  ): Promise<void> {
    const channelCtx = buildChannelContext(db, registry, sseBroker, tenantId, secrets);

    // Direct routing skips preferences (no user account) but NOT rate limit
    // — direct sends can still be abused (webhook replays, test harnesses).
    for (const channel of channels) {
      const address = route[channel.name];
      const message = buildMessage(notificationType, data, channel.name, run.locale);
      if (!address) continue;

      // Address opt-out (critical priority skips it, same rule as user
      // preferences).
      if (
        priority !== "critical" &&
        (await isAddressSuppressed(address, tenantId, notificationType, channel.name))
      ) {
        await logDelivery(run, {
          tenantId,
          notificationType,
          channel: channel.name,
          recipientId,
          // The recipient withdrew — suppressed attempts must not keep recording the address.
          recipientAddress: null,
          status: "skipped",
          error: SKIP.unsubscribed,
          priority,
        });
        continue;
      }

      if (rateLimit) {
        const allowed = await checkRateLimit(rateLimit, tenantId, channel.name);
        if (!allowed) {
          await logDelivery(run, {
            tenantId,
            notificationType,
            channel: channel.name,
            recipientId,
            recipientAddress: address,
            status: "skipped",
            error: SKIP.rate_limited,
            priority,
          });
          continue;
        }
      }

      try {
        await deliverViaChannel({
          run,
          channel,
          address,
          message,
          channelCtx,
          tenantId,
          recipientId,
          notificationType,
          priority,
        });
      } catch (err) {
        logError.error(`${channel.name} channel_error: ${redactedMessageOf(err)}`, {
          notificationType,
          channel: channel.name,
        });
        await logDelivery(run, {
          tenantId,
          notificationType,
          channel: channel.name,
          recipientId,
          recipientAddress: address,
          status: "failed",
          error: "channel_error",
          priority,
        });
      }
    }
  }

  return {
    async notify(notificationType, options, _user, tenantId, jobDispatcher) {
      const { to, route, data, idempotencyKey } = options;
      const priority: NotifyPriority = options.priority ?? "normal";
      const run: NotifyRun = {
        deliveries: [],
        jobDispatcher: options.immediate ? undefined : (jobDispatcher ?? jobRunner),
        locale: options.locale,
      };

      if (idempotencyKey) {
        const first = await claimIdempotency(tenantId, idempotencyKey);
        if (!first) {
          await logDelivery(run, {
            tenantId,
            notificationType,
            channel: "*",
            recipientId: options.recipientId ?? null,
            recipientAddress: null,
            status: "skipped",
            error: SKIP.duplicate_idempotency_key,
            priority,
          });
          return { deliveries: run.deliveries };
        }
      }

      if (route) {
        await deliverDirect(
          route,
          notificationType,
          data,
          tenantId,
          priority,
          options.recipientId ?? null,
          run,
        );
        return { deliveries: run.deliveries };
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
          await deliverToUser(userId, notificationType, data, tenantId, priority, run);
        }
      }
      return { deliveries: run.deliveries };
    },
  };
}
