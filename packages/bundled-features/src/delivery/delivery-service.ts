import type { SseBroker } from "@cosmicdrift/kumiko-framework/api";
import type { DbConnection, DbRow } from "@cosmicdrift/kumiko-framework/db";
import { createSystemDbView, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import type {
  ConfigAccessor,
  DeliveryErrorCode,
  EscapeHatchAuditSink,
  NotifyDelivery,
  NotifyDispatched,
  NotifyJobDispatcher,
  NotifyOptions,
  NotifyPriority,
  Registry,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  assertNotificationVariables,
  bridgeStub,
  createSystemUser,
} from "@cosmicdrift/kumiko-framework/engine";
import type { FileContext } from "@cosmicdrift/kumiko-framework/files";
import { createFallbackLogger, type Logger } from "@cosmicdrift/kumiko-framework/logging";
import {
  assertNotifyTargetsOwnTenant,
  createEscapeHatchReporter,
} from "@cosmicdrift/kumiko-framework/pipeline";
import type { EnvelopeCipher, SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import type { Redis } from "ioredis";
import { fileContextFromResolver } from "../file-foundation/index.ts";
import { redactErrorText } from "../shared/index.ts";
import { hashUnsubscribeAddress } from "./address-opt-out.ts";
import { appendAttemptEvent, logAttempt } from "./attempt-log.ts";
import { buildChannelContext } from "./channel-context.ts";
import {
  DELIVERY_CHANNEL_EXTENSION,
  DeliveryJobs,
  deliveryIdempotencyRedisKey,
  deliveryPriorityRank,
  EMAIL_CHANNEL_NAME,
} from "./constants.ts";
import {
  type AddressOptOutKey,
  addressOptOutKey,
  selectOptedOutAddresses,
} from "./db/queries/address-opt-outs.ts";
import { selectNotificationPreferences } from "./db/queries/preferences.ts";
import { notificationTypeNames } from "./notification-type-aliases.ts";
import { sealRecipientAddress } from "./recipient-address-seal.ts";
import {
  type ChannelContext,
  type ChannelMessage,
  type ChannelResult,
  type DeliveryChannel,
  type DeliveryLogEntry,
  type DeliveryService,
  isDeliveryChannelPlugin,
  type RenderedMessage,
} from "./types.ts";
import {
  buildUnsubscribeUrl,
  type UnsubscribeLinkConfig,
  type UnsubscribeLinkRecipient,
  unsubscribeLinkOrigin,
} from "./unsubscribe-link.ts";

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
  // Seals the recipient address inside queued job payloads (tenant scope). Absent means the
  // payload carries the plaintext address.
  readonly addressCipher?: EnvelopeCipher;
  // File storage for inline-delivered mails with attachments; jobs use their own ctx instead.
  readonly filesForTenant?: (tenantId: string) => FileContext | undefined;
  // Tenant config for inline rendering (mail layout reads tenant name, locale);
  // job-delivered mails get the same accessor from the job context's configFor.
  readonly tenantConfigFor?: (tenantId: TenantId) => ConfigAccessor;
  // Attributed escape-hatch audit for resolveUserIdsForTenant's ctx.systemDb —
  // absent means an unattributed warn log (see fallbackEscapeHatchReporter).
  readonly escapeHatchAuditSink?: EscapeHatchAuditSink;
  readonly log?: Logger;
  // Signs `data.unsubscribeUrl` for email notifications declared with `unsubscribe: true`.
  // The secret must be the one `createUnsubscribeRoutes` verifies with.
  readonly unsubscribeLinks?: UnsubscribeLinkConfig;
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
    addressCipher,
    filesForTenant,
    tenantConfigFor,
    escapeHatchAuditSink,
    log,
    unsubscribeLinks,
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
    const res = await idemRedis.set(
      deliveryIdempotencyRedisKey(tenantId, key),
      "1",
      "EX",
      ttlSec,
      "NX",
    );
    return res === "OK";
  }

  function isDeliveredOrQueued(delivery: NotifyDelivery): boolean {
    return delivery.status === "sent" || delivery.status === "queued";
  }

  // A key that guarded nothing must not turn the caller's retry into a skipped duplicate.
  // Partial success keeps it: a retry would re-send to those who got it.
  // A failing release is logged and swallowed: it must neither replace the dispatch error the
  // caller retries on nor fail a notify() that already dispatched.
  async function releaseIdempotencyIfNothingDelivered(
    tenantId: TenantId,
    key: string | undefined,
    run: NotifyRun,
    notificationType: string,
  ): Promise<void> {
    // skip: no key claimed, or a recipient already got the notification
    if (!key || run.deliveries.some(isDeliveredOrQueued)) return;
    try {
      await idemRedis?.del(deliveryIdempotencyRedisKey(tenantId, key));
    } catch (releaseErr) {
      logError.warn(`idempotency key release failed: ${redactedMessageOf(releaseErr)}`, {
        notificationType,
      });
    }
  }

  // Only a single-channel route lets the queued job free the key on terminal failure
  // without risking a duplicate send on another channel.
  function jobIdempotencyKeyFor(
    idempotencyKey: string | undefined,
    route: NotifyOptions["route"],
  ): string | undefined {
    if (!idempotencyKey || !route) return undefined;
    const routedChannelCount = channels.filter((channel) => route[channel.name]).length;
    return routedChannelCount === 1 ? idempotencyKey : undefined;
  }

  async function resolveUserIdsForTenant(
    run: NotifyRun,
    tenantId: TenantId,
  ): Promise<readonly string[]> {
    if (!tenantUserIdsQuery) {
      throw new Error(
        "Tenant broadcast (to: { tenant }) requires the tenant feature (default wiring) or an explicit tenantUserIdsQuery in DeliveryServiceOptions",
      );
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
      log: logError,
    });
    // ctx.db/dbOutsideTransaction are tenant-filtered even for a systemScope handler:
    // the dispatcher closes them off entirely there, so "system" mode would hand this
    // path a cross-tenant read the dispatcher never allows. Cross-tenant reach only
    // exists through the grant-carrying systemDb view below.
    const isSystem = registry.isHandlerSystemScoped(tenantUserIdsQuery);
    const tenantDb = createTenantDb({
      db: run.db,
      tenantId,
      mode: "tenant",
      grants: {
        report,
      },
    });
    // The dispatcher grants a systemScope handler's ctx.systemDb.unsafeRaw() ungated —
    // the grant comes from the handler's own r.systemScope() registration, not from this
    // caller. Only the systemDb view's own source TenantDb carries the grant, so it
    // can't leak onto ctx.db.
    const systemDbSourceTenantDb = isSystem
      ? createTenantDb({
          db: run.db,
          tenantId,
          mode: "system",
          grants: {
            report,
            unsafeRaw: { reason: `r.systemScope() handler "${tenantUserIdsQuery}"` },
          },
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
    // All DB work of the call runs here: inside a write transaction the caller passes the
    // outside-tx pool, because the app pool's slots may all be held by waiting write txs.
    readonly db: DbConnection;
    readonly deliveries: NotifyDelivery[];
    readonly jobDispatcher: NotifyJobDispatcher | undefined;
    readonly locale: string | undefined;
    // Set only when exactly one channel carries the call: the queued job may then free
    // the key on terminal failure without risking a duplicate send on another channel.
    readonly jobIdempotencyKey: string | undefined;
    readonly filesForTenant: ((tenantId: string) => FileContext | undefined) | undefined;
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
      ...(entry.confirmed === false && { confirmed: entry.confirmed }),
      deliveryAttemptId,
    });
  }

  // Single-shot terminal log (inline channels, skips, idempotency dups). Async
  // attempts instead append a queued event up front and a terminal event from
  // the send job — see deliverViaChannel + jobs.ts.
  async function logDelivery(run: NotifyRun, entry: DeliveryLogEntry): Promise<void> {
    const attemptId = await logAttempt(run.db, registry, entry);
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
      await appendAttemptEvent(run.db, registry, deliveryAttemptId, queuedEntry);
      await run.jobDispatcher.dispatch(
        channel.render ? DeliveryJobs.render : DeliveryJobs.send,
        {
          channelName: channel.name,
          ...(await sealRecipientAddress(address, tenantId, addressCipher)),
          tenantId,
          recipientId,
          notificationType,
          deliveryAttemptId,
          priority,
          message,
          ...(run.jobIdempotencyKey !== undefined && { idempotencyKey: run.jobIdempotencyKey }),
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
          // skip: logInlineFailure recorded and logged the failure
          return;
        }
      }
      let result: ChannelResult;
      try {
        result = await channel.send(address, message, channelCtx, rendered);
      } catch (err) {
        await logInlineFailure(run, args, "send_failed", err);
        // skip: logInlineFailure recorded and logged the failure
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
        ...(result.confirmed === false && { confirmed: result.confirmed }),
      });
    }
  }

  // A caller-supplied unsubscribeUrl wins; the recipient comes from the server-side notify
  // context, never from the notification data.
  async function withUnsubscribeUrl(
    message: ChannelMessage,
    channelName: string,
    recipient: UnsubscribeLinkRecipient,
    channelCtx: ChannelContext,
  ): Promise<ChannelMessage> {
    if (!unsubscribeLinks || channelName !== EMAIL_CHANNEL_NAME) return message;
    if (registry.getAllNotifications().get(message.notificationType)?.unsubscribe !== true) {
      return message;
    }
    const supplied = message.data?.["unsubscribeUrl"];
    if (typeof supplied === "string" && supplied !== "") return message;
    const origin = await unsubscribeLinkOrigin(unsubscribeLinks, channelCtx, (reason) =>
      logError.warn(`unsubscribe link falls back to the app origin: ${reason}`, {
        tenantId: channelCtx.tenantId,
        notificationType: message.notificationType,
      }),
    );
    const unsubscribeUrl = await buildUnsubscribeUrl(unsubscribeLinks, origin, recipient, {
      tenantId: channelCtx.tenantId,
      notificationType: message.notificationType,
      channel: channelName,
      locale: message.locale,
    });
    return unsubscribeUrl === undefined
      ? message
      : { ...message, data: { ...message.data, unsubscribeUrl } };
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
  // no blind-index key configured means no hash, so nothing to look up. One
  // query per notify() call, not per recipient and channel.
  async function loadSuppressedAddresses(
    run: NotifyRun,
    tenantId: TenantId,
    notificationType: string,
    priority: NotifyPriority,
    addresses: Iterable<string>,
  ): Promise<ReadonlySet<AddressOptOutKey>> {
    // Critical priority skips address opt-outs, same rule as user preferences.
    if (priority === "critical") return new Set();
    const addressHashes = new Set<string>();
    for (const address of addresses) {
      const addressHash = hashUnsubscribeAddress(address);
      if (addressHash !== undefined) addressHashes.add(addressHash);
    }
    return selectOptedOutAddresses(
      run.db,
      tenantId,
      notificationTypeNames(registry, notificationType),
      [...addressHashes],
    );
  }

  function isAddressSuppressed(
    suppressed: ReadonlySet<AddressOptOutKey>,
    address: string,
    channelName: string,
  ): boolean {
    const addressHash = hashUnsubscribeAddress(address);
    return addressHash !== undefined && suppressed.has(addressOptOutKey(addressHash, channelName));
  }

  const recipientChannelKey = (userId: string, channelName: string) => `${userId}|${channelName}`;

  type ChannelGate = "open" | "channel_disabled" | "preference_disabled" | "rate_limited";
  type PrefetchedRecipients = {
    readonly addresses: ReadonlyMap<string, string | null>;
    readonly gates: ReadonlyMap<string, ChannelGate>;
  };

  // Kill switch, then the user's preference, then the rate limit — the order deliverToUser reports
  // skips in. The rate limit consumes a token, so each recipient/channel pair is evaluated once.
  async function evaluateChannelGate(
    run: NotifyRun,
    userId: string,
    tenantId: TenantId,
    notificationType: string,
    channelName: string,
    priority: NotifyPriority,
  ): Promise<ChannelGate> {
    if (isChannelKilled && (await isChannelKilled(tenantId, channelName))) {
      return "channel_disabled";
    }
    // Critical priority skips the preference check
    if (
      priority !== "critical" &&
      !(await isChannelEnabled(run, userId, tenantId, notificationType, channelName))
    ) {
      return "preference_disabled";
    }
    if (rateLimit && !(await checkRateLimit(rateLimit, tenantId, channelName))) {
      return "rate_limited";
    }
    return "open";
  }

  // Resolves every user's channel addresses up front so the opt-out lookup can
  // cover them all at once. A resolve that throws stays out of the address map:
  // the delivery loop resolves it again and reports channel_error as before.
  // Channels that are gated (kill switch, preferences, rate limit) are never resolved
  // here: resolve may have side effects and deliverToUser skips those channels. The
  // gate verdict is kept so deliverToUser does not query it a second time.
  async function prefetchRecipients(
    run: NotifyRun,
    userIds: readonly string[],
    tenantId: TenantId,
    notificationType: string,
    priority: NotifyPriority,
  ): Promise<PrefetchedRecipients> {
    const addresses = new Map<string, string | null>();
    const gates = new Map<string, ChannelGate>();
    const channelCtx = buildChannelContext(
      run.db,
      registry,
      sseBroker,
      tenantId,
      secrets,
      tenantConfigFor?.(tenantId),
      run.filesForTenant,
    );
    for (const userId of userIds) {
      for (const channel of channels) {
        if (!channel.resolve) continue;
        const key = recipientChannelKey(userId, channel.name);
        try {
          const gate = await evaluateChannelGate(
            run,
            userId,
            tenantId,
            notificationType,
            channel.name,
            priority,
          );
          gates.set(key, gate);
          if (gate !== "open") continue;
          addresses.set(key, await channel.resolve(userId, channelCtx));
        } catch {
          // skip: re-resolved (and logged) by deliverToUser
        }
      }
    }
    return { addresses, gates };
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
    run: NotifyRun,
    userId: string,
    tenantId: TenantId,
    notificationType: string,
    channelName: string,
  ): Promise<boolean> {
    const prefs = await selectNotificationPreferences(
      run.db,
      tenantId,
      userId,
      notificationTypeNames(registry, notificationType),
      channelName,
    );

    if (prefs.length === 0) return true;

    // Exact match (both specific) wins over any wildcard
    const exact = prefs.find(
      (p) => p.notificationType === notificationType && p.channel === channelName,
    );
    if (exact) return exact.enabled;

    // Rows stored under a former name: the user's choice from before the rename
    const aliasExact = prefs.filter(
      (p) =>
        p.notificationType !== "*" &&
        p.notificationType !== notificationType &&
        p.channel === channelName,
    );
    if (aliasExact.length > 0) return !aliasExact.some((p) => p.enabled === false);

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
    prefetched: PrefetchedRecipients,
    suppressed: ReadonlySet<AddressOptOutKey>,
  ): Promise<void> {
    const channelCtx = buildChannelContext(
      run.db,
      registry,
      sseBroker,
      tenantId,
      secrets,
      tenantConfigFor?.(tenantId),
      run.filesForTenant,
    );

    for (const channel of channels) {
      // Route-only channel (no per-user address): not a user-notification target.
      if (!channel.resolve) continue;

      const message = buildMessage(notificationType, data, channel.name, run.locale);

      const prefetchKey = recipientChannelKey(userId, channel.name);
      const gate =
        prefetched.gates.get(prefetchKey) ??
        (await evaluateChannelGate(
          run,
          userId,
          tenantId,
          notificationType,
          channel.name,
          priority,
        ));
      if (gate !== "open") {
        await logDelivery(run, {
          tenantId,
          notificationType,
          channel: channel.name,
          recipientId: userId,
          recipientAddress: null,
          status: "skipped",
          error: gate,
          priority,
        });
        continue;
      }

      try {
        const wasPrefetched = prefetched.addresses.has(prefetchKey);
        const address = wasPrefetched
          ? prefetched.addresses.get(prefetchKey)
          : await channel.resolve(userId, channelCtx);
        if (!address) {
          await logDelivery(run, {
            tenantId,
            notificationType,
            channel: channel.name,
            recipientId: userId,
            recipientAddress: null,
            status: "skipped",
            error: "no_address",
            priority,
          });
          continue;
        }

        // A fallback resolve yields an address the batched opt-out lookup never covered.
        const suppressedForAddress = wasPrefetched
          ? suppressed
          : await loadSuppressedAddresses(run, tenantId, notificationType, priority, [address]);
        if (
          priority !== "critical" &&
          isAddressSuppressed(suppressedForAddress, address, channel.name)
        ) {
          await logDelivery(run, {
            tenantId,
            notificationType,
            channel: channel.name,
            recipientId: userId,
            recipientAddress: null,
            status: "skipped",
            error: "unsubscribed",
            priority,
          });
          continue;
        }

        await deliverViaChannel({
          run,
          channel,
          address,
          message: await withUnsubscribeUrl(
            message,
            channel.name,
            { kind: "user", userId },
            channelCtx,
          ),
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
    const channelCtx = buildChannelContext(
      run.db,
      registry,
      sseBroker,
      tenantId,
      secrets,
      tenantConfigFor?.(tenantId),
      run.filesForTenant,
    );
    const suppressed = await loadSuppressedAddresses(
      run,
      tenantId,
      notificationType,
      priority,
      Object.values(route),
    );

    // Direct routing skips preferences (no user account) but NOT rate limit
    // — direct sends can still be abused (webhook replays, test harnesses).
    for (const channel of channels) {
      const address = route[channel.name];
      const message = buildMessage(notificationType, data, channel.name, run.locale);
      if (!address) continue;

      // Address opt-out (critical priority skips it, same rule as user
      // preferences).
      if (priority !== "critical" && isAddressSuppressed(suppressed, address, channel.name)) {
        await logDelivery(run, {
          tenantId,
          notificationType,
          channel: channel.name,
          recipientId,
          // The recipient withdrew — suppressed attempts must not keep recording the address.
          recipientAddress: null,
          status: "skipped",
          error: "unsubscribed",
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
            error: "rate_limited",
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
          message: await withUnsubscribeUrl(
            message,
            channel.name,
            { kind: "address", address },
            channelCtx,
          ),
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

  async function dispatchNotification(
    notificationType: string,
    options: NotifyOptions,
    tenantId: TenantId,
    priority: NotifyPriority,
    run: NotifyRun,
  ): Promise<void> {
    const { to, route, data } = options;
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
      // skip: explicit route is delivered directly, no recipient resolution needed
      return;
    }

    if (to !== undefined) {
      let userIds: readonly string[];

      if (typeof to === "string") {
        userIds = [to];
      } else if ("tenant" in to) {
        userIds = await resolveUserIdsForTenant(run, to.tenant);
      } else {
        userIds = to;
      }

      const prefetched: PrefetchedRecipients =
        priority === "critical"
          ? { addresses: new Map(), gates: new Map() }
          : await prefetchRecipients(run, userIds, tenantId, notificationType, priority);
      const suppressed = await loadSuppressedAddresses(
        run,
        tenantId,
        notificationType,
        priority,
        [...prefetched.addresses.values()].filter((address): address is string => !!address),
      );

      for (const userId of userIds) {
        await deliverToUser(
          userId,
          notificationType,
          data,
          tenantId,
          priority,
          run,
          prefetched,
          suppressed,
        );
      }
    }
  }

  function dispatched(run: NotifyRun): NotifyDispatched {
    return { kind: "dispatched", deliveries: run.deliveries };
  }

  return {
    async notify(
      notificationType,
      options,
      _user,
      tenantId,
      jobDispatcher,
      deliveryDb,
      fileProviderResolver,
    ) {
      assertNotifyTargetsOwnTenant(options, tenantId);
      assertNotificationVariables(registry, notificationType, options.data);
      const { route, idempotencyKey } = options;
      const priority: NotifyPriority = options.priority ?? "normal";
      const run: NotifyRun = {
        db: deliveryDb ?? db,
        deliveries: [],
        jobDispatcher: options.immediate ? undefined : (jobDispatcher ?? jobRunner),
        locale: options.locale,
        jobIdempotencyKey: jobIdempotencyKeyFor(idempotencyKey, route),
        filesForTenant:
          fileProviderResolver === undefined
            ? filesForTenant
            : (fileTenantId) => fileContextFromResolver(fileProviderResolver, fileTenantId),
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
            error: "duplicate_idempotency_key",
            priority,
          });
          return dispatched(run);
        }
      }

      try {
        await dispatchNotification(notificationType, options, tenantId, priority, run);
      } catch (err) {
        await releaseIdempotencyIfNothingDelivered(tenantId, idempotencyKey, run, notificationType);
        throw err;
      }
      await releaseIdempotencyIfNothingDelivered(tenantId, idempotencyKey, run, notificationType);
      return dispatched(run);
    },
  };
}
