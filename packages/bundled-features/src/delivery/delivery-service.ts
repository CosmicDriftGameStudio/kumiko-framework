import type { SseBroker } from "@cosmicdrift/kumiko-framework/api";
import type { DbConnection, DbRow } from "@cosmicdrift/kumiko-framework/db";
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
import { assertNotificationVariables } from "@cosmicdrift/kumiko-framework/engine";
import type { FileContext } from "@cosmicdrift/kumiko-framework/files";
import { createFallbackLogger, type Logger } from "@cosmicdrift/kumiko-framework/logging";
import { assertNotifyTargetsOwnTenant } from "@cosmicdrift/kumiko-framework/pipeline";
import type { EnvelopeCipher, SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import type { Redis } from "ioredis";
import { fileContextFromResolver } from "../file-foundation/index.ts";
import { collectExtensionOptions, errorKindOf } from "../shared/index.ts";
import { hashUnsubscribeAddress } from "./address-opt-out.ts";
import { appendAttemptEvent, logAttempt } from "./attempt-log.ts";
import { buildChannelContext } from "./channel-context.ts";
import {
  DELIVERY_CHANNEL_EXTENSION,
  DeliveryJobs,
  deliveryPriorityRank,
  EMAIL_CHANNEL_NAME,
} from "./constants.ts";
import {
  type AddressOptOutKey,
  addressOptOutKey,
  selectOptedOutAddresses,
} from "./db/queries/address-opt-outs.ts";
import {
  claimDeliveryIdempotency,
  jobIdempotencyKeyFor,
  releaseIdempotencyIfNothingDelivered,
} from "./delivery-idempotency.ts";
import {
  checkDeliveryRateLimit,
  type RateLimitConfig,
  registerDeliveryRateLimitScript,
} from "./delivery-rate-limit.ts";
import { sealJobContent } from "./job-content-seal.ts";
import {
  isChannelEnabledByPreferences,
  loadPreferencesByUser,
  type PreferencesByUser,
} from "./notification-preference-gate.ts";
import { notificationTypeNames } from "./notification-type-aliases.ts";
import { resolveUserIdsForTenant } from "./tenant-recipients.ts";
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
  // Job dispatcher for async (queued-mode) channels: email/chat render+send
  // run in the delivery.send job. notify() may override it per
  // call. When neither is present, queued channels fall back to synchronous
  // inline delivery (job-less setups, unit tests).
  readonly jobRunner?: NotifyJobDispatcher;
  // Credentials source for inline-delivered chat channels (webhook URL / bot
  // token). Jobs get ctx.services.secrets from the job runner instead.
  readonly secrets?: SecretsContext;
  // Seals recipient address and message content inside queued job payloads (tenant scope).
  // Absent means the payload carries them as plaintext.
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
  return collectExtensionOptions(registry, DELIVERY_CHANNEL_EXTENSION, isDeliveryChannelPlugin);
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

  if (rateLimit) registerDeliveryRateLimitScript(rateLimit.redis);

  const tenantRecipientDeps = { registry, tenantUserIdsQuery, escapeHatchAuditSink, log: logError };

  // State of one notify() call: collects the per-channel outcome returned to
  // the caller. Passed explicitly — the service itself is shared across calls.
  type NotifyRun = {
    // All DB work of the call runs here: inside a write transaction the caller passes the
    // outside-tx pool, because the app pool's slots may all be held by waiting write txs.
    readonly db: DbConnection;
    readonly deliveries: NotifyDelivery[];
    readonly jobDispatcher: NotifyJobDispatcher | undefined;
    readonly locale: string | undefined;
    readonly channelNames: ReadonlySet<string> | undefined;
    // Set only when exactly one channel carries the call: the queued job may then free
    // the key on terminal failure without risking a duplicate send on another channel.
    readonly jobIdempotencyKey: string | undefined;
    // The caller's key as given, stamped on every attempt the call logs.
    readonly idempotencyKey: string | undefined;
    readonly filesForTenant: ((tenantId: string) => FileContext | undefined) | undefined;
    // One kill-switch lookup per tenant and channel per notify() call.
    readonly killSwitchVerdicts: Map<string, Promise<boolean>>;
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
  function withIdempotencyKey(run: NotifyRun, entry: DeliveryLogEntry): DeliveryLogEntry {
    return run.idempotencyKey === undefined
      ? entry
      : { ...entry, idempotencyKey: run.idempotencyKey };
  }

  async function logDelivery(run: NotifyRun, entry: DeliveryLogEntry): Promise<void> {
    const stamped = withIdempotencyKey(run, entry);
    const attemptId = await logAttempt(run.db, registry, stamped);
    recordDelivery(run, stamped, attemptId);
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
    logError.error(`${args.channel.name} ${code}: ${errorKindOf(err)}`, {
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
  // status. Queued channels (email, chat) record a `queued` attempt up front and
  // hand off to the delivery.send job, which appends the
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

    if (channel.mode === "queued" && run.jobDispatcher && addressCipher) {
      // Async hand-off: record the attempt as queued, then dispatch the send
      // job — the terminal sent/failed event is appended by the job, not here.
      const queuedEntry = withIdempotencyKey(run, {
        tenantId,
        notificationType,
        channel: channel.name,
        recipientId,
        recipientAddress: address,
        status: "queued",
        error: null,
        priority,
      });
      const deliveryAttemptId = await logAttempt(run.db, registry, queuedEntry);
      try {
        await run.jobDispatcher.dispatch(
          DeliveryJobs.send,
          {
            channelName: channel.name,
            ...(await sealJobContent({ address, message }, tenantId, addressCipher)),
            tenantId,
            recipientId,
            notificationType,
            deliveryAttemptId,
            priority,
            ...(run.jobIdempotencyKey !== undefined && { idempotencyKey: run.jobIdempotencyKey }),
            ...(run.idempotencyKey !== undefined && { notifyIdempotencyKey: run.idempotencyKey }),
          },
          { priority: deliveryPriorityRank[priority] },
        );
      } catch (err) {
        // Closes the queued attempt on its own stream: a rethrow would make deliverToUser log a
        // second, separate failed attempt and leave this one queued forever.
        const failedEntry: DeliveryLogEntry = {
          ...queuedEntry,
          status: "failed",
          error: "channel_error",
        };
        logError.error(`${channel.name} job dispatch failed: ${errorKindOf(err)}`, {
          notificationType,
          channel: channel.name,
        });
        await appendAttemptEvent(run.db, registry, deliveryAttemptId, failedEntry);
        recordDelivery(run, failedEntry, deliveryAttemptId);
        return;
      }
      recordDelivery(run, queuedEntry, deliveryAttemptId);
    } else {
      // Inline (inApp), no job runner, or no address cipher: render and send synchronously so no
      // plaintext address lands in a job payload.
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

  // The app's tenantOrigin callback typically hits the DB: once per run and tenant, not per recipient.
  const unsubscribeOriginsByRun = new WeakMap<NotifyRun, Map<TenantId, Promise<string>>>();

  function unsubscribeOriginOnce(
    run: NotifyRun,
    links: UnsubscribeLinkConfig,
    channelCtx: ChannelContext,
    notificationType: string,
  ): Promise<string> {
    let originsByTenant = unsubscribeOriginsByRun.get(run);
    if (originsByTenant === undefined) {
      originsByTenant = new Map();
      unsubscribeOriginsByRun.set(run, originsByTenant);
    }
    let origin = originsByTenant.get(channelCtx.tenantId);
    if (origin === undefined) {
      origin = unsubscribeLinkOrigin(links, channelCtx, (reason) =>
        logError.warn(`unsubscribe link falls back to the app origin: ${reason}`, {
          tenantId: channelCtx.tenantId,
          notificationType,
        }),
      );
      originsByTenant.set(channelCtx.tenantId, origin);
    }
    return origin;
  }

  // A caller-supplied unsubscribeUrl wins; the recipient comes from the server-side notify
  // context, never from the notification data.
  async function withUnsubscribeUrl(
    run: NotifyRun,
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
    const origin = await unsubscribeOriginOnce(
      run,
      unsubscribeLinks,
      channelCtx,
      message.notificationType,
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

  const isChannelSelected = (run: NotifyRun, channelName: string) =>
    run.channelNames === undefined || run.channelNames.has(channelName);

  type ChannelGate = "open" | "channel_disabled" | "preference_disabled" | "rate_limited";
  type PrefetchedRecipients = {
    readonly addresses: ReadonlyMap<string, string | null>;
    readonly gates: ReadonlyMap<string, ChannelGate>;
    readonly preferences: PreferencesByUser;
  };

  function killSwitchVerdict(
    run: NotifyRun,
    tenantId: TenantId,
    channelName: string,
  ): Promise<boolean> {
    if (!isChannelKilled) return Promise.resolve(false);
    const key = `${tenantId}|${channelName}`;
    let verdict = run.killSwitchVerdicts.get(key);
    if (verdict === undefined) {
      verdict = isChannelKilled(tenantId, channelName);
      run.killSwitchVerdicts.set(key, verdict);
    }
    return verdict;
  }

  // Kill switch, then the user's preference, then the rate limit — the order deliverToUser reports
  // skips in. The rate limit consumes a token, so each recipient/channel pair is evaluated once.
  async function evaluateChannelGate(
    run: NotifyRun,
    preferences: PreferencesByUser,
    userId: string,
    tenantId: TenantId,
    notificationType: string,
    channelName: string,
    priority: NotifyPriority,
  ): Promise<ChannelGate> {
    if (await killSwitchVerdict(run, tenantId, channelName)) {
      return "channel_disabled";
    }
    // Critical priority skips the preference check
    if (
      priority !== "critical" &&
      !isChannelEnabledByPreferences(
        preferences.get(userId) ?? [],
        notificationTypeNames(registry, notificationType),
        notificationType,
        channelName,
      )
    ) {
      return "preference_disabled";
    }
    // Per recipient and channel on purpose: every call consumes a rate-limit token.
    if (rateLimit && !(await checkDeliveryRateLimit(rateLimit, tenantId, channelName))) {
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
    const preferences = await loadPreferencesByUser(
      run.db,
      tenantId,
      userIds,
      notificationTypeNames(registry, notificationType),
    );
    const channelCtx = buildChannelContext(
      run.db,
      registry,
      sseBroker,
      tenantId,
      secrets,
      tenantConfigFor?.(tenantId),
      run.filesForTenant,
      run.idempotencyKey,
    );
    for (const userId of userIds) {
      for (const channel of channels) {
        if (!channel.resolve || !isChannelSelected(run, channel.name)) continue;
        const key = recipientChannelKey(userId, channel.name);
        try {
          const gate = await evaluateChannelGate(
            run,
            preferences,
            userId,
            tenantId,
            notificationType,
            channel.name,
            priority,
          );
          gates.set(key, gate);
          if (gate !== "open") continue;
          addresses.set(key, await channel.resolve(userId, channelCtx));
        } catch (err) {
          // The per-recipient delivery path resolves again and decides the outcome; this only surfaces the early failure.
          logError.warn("channel pre-resolve failed", {
            channel: channel.name,
            notificationType,
            error: errorKindOf(err),
          });
        }
      }
    }
    return { addresses, gates, preferences };
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
      run.idempotencyKey,
    );

    for (const channel of channels) {
      // Route-only channel (no per-user address): not a user-notification target.
      if (!channel.resolve || !isChannelSelected(run, channel.name)) continue;

      const message = buildMessage(notificationType, data, channel.name, run.locale);

      const prefetchKey = recipientChannelKey(userId, channel.name);
      const gate =
        prefetched.gates.get(prefetchKey) ??
        (await evaluateChannelGate(
          run,
          prefetched.preferences,
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
            run,
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
        logError.error(`${channel.name} channel_error: ${errorKindOf(err)}`, {
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
      run.idempotencyKey,
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
        const allowed = await checkDeliveryRateLimit(rateLimit, tenantId, channel.name);
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
            run,
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
        logError.error(`${channel.name} channel_error: ${errorKindOf(err)}`, {
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
        userIds = await resolveUserIdsForTenant(tenantRecipientDeps, run.db, to.tenant);
      } else {
        userIds = to;
      }

      const prefetched: PrefetchedRecipients =
        priority === "critical"
          ? { addresses: new Map(), gates: new Map(), preferences: new Map() }
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
        channelNames: options.channels === undefined ? undefined : new Set(options.channels),
        killSwitchVerdicts: new Map(),
        jobIdempotencyKey: jobIdempotencyKeyFor(channels, idempotencyKey, route),
        idempotencyKey,
        filesForTenant:
          fileProviderResolver === undefined
            ? filesForTenant
            : (fileTenantId) => fileContextFromResolver(fileProviderResolver, fileTenantId),
      };

      if (idempotencyKey) {
        const first = await claimDeliveryIdempotency(idemRedis, tenantId, idempotencyKey);
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
        await releaseIdempotencyIfNothingDelivered({
          redis: idemRedis,
          log: logError,
          tenantId,
          key: idempotencyKey,
          deliveries: run.deliveries,
          notificationType,
        });
        throw err;
      }
      await releaseIdempotencyIfNothingDelivered({
        redis: idemRedis,
        log: logError,
        tenantId,
        key: idempotencyKey,
        deliveries: run.deliveries,
        notificationType,
      });
      return dispatched(run);
    },
    async logAttempt(entry, deliveryDb) {
      await logAttempt(deliveryDb ?? db, registry, entry);
    },
  };
}
