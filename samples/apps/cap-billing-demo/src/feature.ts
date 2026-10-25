// kumiko-feature-version: 1
//
// newsletter — demo feature that brings together tier-engine + cap-counter + the
// mail-foundation plugin API.
//
// **What happens in the send handler:**
//   1. Pre-call (via the withCapEnforcement wrapper):
//      a) Read the tenant tier from ctx.config
//      b) Map tier → cap limit from DEMO_TIER_MAP
//      c) enforceCapAndMaybeNotify calls enforceCap → on a
//         soft-hit crossing the notifier (sends a warning mail via
//         the same mail-foundation, to the admin) AND dispatches
//         mark-soft-warned
//   2. Inner handler: createTransportForTenant → transport.send
//   3. Post-success: increment the cap counter by 1
//
// **Observable in the in-memory inbox** (mail-transport-inmemory):
//   - The "real" newsletter mails (to event.payload.to)
//   - The soft-hit warning mails (to admin@tenant.demo, on the first
//     crossing)
//
// **Tier switching:** the primary source is the `subscription` row from
// billing-foundation (= productive path: a Stripe/Mollie webhook
// writes → the tier changes). The fallback is the config key
// "newsletter:config:tier" — the demo README uses it for manual
// switching without a provider, and tier-engine-only tests keep their
// existing flow.

import {
  BILLING_FOUNDATION_FEATURE,
  getSubscriptionForTenant,
  SubscriptionStatuses,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import {
  currentCalendarMonthStartIso,
  type SoftHitNotifier,
  withCapEnforcement,
} from "@cosmicdrift/kumiko-bundled-features/cap-counter";
import type { EmailMessage } from "@cosmicdrift/kumiko-bundled-features/channel-email";
import {
  createMailFoundationFeature,
  createTransportForTenant,
  type MailTransportContext,
} from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import {
  access,
  createTenantConfig,
  defineFeature,
  type ReservationContext,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { DEMO_TIER_MAP, TIER_NAMES, type TierName } from "./tier-map";

const FEATURE_NAME = "newsletter";

// The transport factory takes a narrow context (it also runs in the worker), so the handler's
// secrets live under services and are handed over explicitly.
function mailContextOf(
  ctx: Pick<ReservationContext, "config" | "registry" | "services" | "user">,
): MailTransportContext {
  return {
    config: ctx.config,
    registry: ctx.registry,
    secrets: ctx.services.secrets,
    auditUserId: ctx.user.id,
  };
}
const NEWSLETTER_CAP = "newsletters-per-month";

// =============================================================================
// Inner send-handler
// =============================================================================

const sendSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  html: z.string().min(1),
});

const innerSendHandler: WriteHandlerDef = {
  name: "send",
  schema: sendSchema,
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async (event, ctx) => {
    const payload = event.payload as z.infer<typeof sendSchema>;
    const transport = await createTransportForTenant(
      mailContextOf(ctx),
      event.user.tenantId,
      "newsletter:write:send",
    );
    await transport.send({
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    });
    return { isSuccess: true as const, data: { sent: true } };
  },
};

// =============================================================================
// Tier-Lookup + Cap-Resolver
// =============================================================================

/**
 * Resolve the tenant tier.
 *
 * **Order:**
 *   1. subscription row from billing-foundation (= productive
 *      path). If the row exists, it beats the config fallback —
 *      even in canceled status (= the tenant falls back to free, NOT
 *      to an orphaned config="pro" override).
 *   2. config key "newsletter:config:tier" (= demo README path without
 *      a provider; the tier-engine-only path of the original
 *      tests stays green too).
 *   3. Default "free".
 *
 * The whitelist filter via TIER_NAMES prevents typos ("Pro" / "Premium")
 * that would otherwise silently fall back to free.
 */
function isValidTierName(value: string): value is TierName {
  return (TIER_NAMES as readonly string[]).includes(value);
}

async function resolveTier(ctx: ReservationContext): Promise<TierName> {
  const tenantId = ctx.user?.tenantId;
  if (tenantId) {
    const sub = await getSubscriptionForTenant(ctx, tenantId);
    if (sub) {
      // Subscription existiert → trumpft config. Bei active+valid-tier
      // → der subscription-tier; sonst free (canceled/past_due/etc).
      if (sub.status === SubscriptionStatuses.active && isValidTierName(sub.tier)) {
        return sub.tier;
      }
      return "free";
    }
  }

  const raw = (await ctx.config?.("newsletter:config:tier")) as string | undefined;
  if (raw && isValidTierName(raw)) {
    return raw;
  }
  return "free";
}

/** Notifier factory: builds a SoftHitNotifier that sends the warning via
 *  the same mail-foundation to the tenant admin. */
function buildSoftHitNotifier(ctx: ReservationContext): SoftHitNotifier {
  return async (info) => {
    const transport = await createTransportForTenant(
      mailContextOf(ctx),
      info.tenantId,
      "newsletter:soft-hit-notifier",
    );
    const message: EmailMessage = {
      to: `admin@tenant-${info.tenantId.slice(-4)}.demo`,
      subject: `[Cap Warning] '${info.capName}' bei ${info.value}/${info.limit}`,
      html:
        `<p>Hallo Admin,</p>` +
        `<p>der Cap <strong>${info.capName}</strong> für deinen Tenant ist bei <strong>${info.value}</strong> von ${info.limit} angekommen.</p>` +
        `<p>Du bist im soft-Bereich (110% des Limits). Hard-Block kommt bei 120%. Upgrade auf einen höheren Tier oder warte auf den nächsten Monatsreset.</p>`,
    };
    await transport.send(message);
  };
}

// =============================================================================
// Wrapped send-handler (cap-aware)
// =============================================================================

const wrappedSendHandler = withCapEnforcement(innerSendHandler, async (_event, ctx) => {
  const tier = await resolveTier(ctx);
  // resolveTier returns one of TIER_NAMES; DEMO_TIER_MAP has an entry
  // for each. tsc's `noUncheckedIndexedAccess` doesn't carry that
  // narrowing through a Record-lookup — extract via const + non-null
  // assert (= contract: tier is always a valid key here, see TIER_NAMES
  // whitelist in resolveTier).
  const tierEntry = DEMO_TIER_MAP[tier];
  if (!tierEntry) {
    throw new Error(`newsletter: tier "${tier}" not in DEMO_TIER_MAP — TIER_NAMES drift?`);
  }
  const limit = tierEntry.caps.newslettersPerMonth;
  return {
    capName: NEWSLETTER_CAP,
    periodStartIso: currentCalendarMonthStartIso(),
    limit,
    profile: "burstable",
    notify: buildSoftHitNotifier(ctx),
  };
});

// =============================================================================
// Feature-definition
// =============================================================================

export const newsletterFeature = defineFeature(FEATURE_NAME, (r) => {
  // Hard deps: mail-foundation for the plugin API + config for the tier choice +
  // cap-counter (transitive via withCapEnforcement, but explicit is
  // clearer for boot-validator errors).
  r.requires({ features: ["config"] });
  r.requires({ features: ["cap-counter"] });
  r.requires({ features: [createMailFoundationFeature().name] });
  r.requires({ features: [BILLING_FOUNDATION_FEATURE] });

  // Tier-config-key. Tenant-Admin setzt's; default "free".
  r.config(
    "tier",
    createTenantConfig("select", {
      default: "free",
      options: TIER_NAMES,
      write: access.roles("TenantAdmin", "SystemAdmin"),
      read: access.roles("TenantAdmin", "SystemAdmin", "User"),
    }),
  );

  r.writeHandler(wrappedSendHandler);
});

/** QN for the send handler — exported so tests + clients can access it
 *  without deriving it by hand. */
export const NEWSLETTER_SEND_QN = "newsletter:write:send";
export const NEWSLETTER_TIER_CONFIG_KEY = "newsletter:config:tier";
