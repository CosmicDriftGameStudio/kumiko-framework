// kumiko-feature-version: 1
//
// newsletter — Demo-Feature, das tier-engine + cap-counter + die
// mail-foundation Plugin-API zusammenbringt.
//
// **Was passiert beim send-Handler:**
//   1. Pre-Call (via withCapEnforcement-Wrapper):
//      a) Tenant-Tier aus ctx.config lesen
//      b) Tier → cap-limit aus DEMO_TIER_MAP mappen
//      c) enforceCapAndMaybeNotify ruft enforceCap → bei
//         soft-hit-crossing den Notifier (sendet Warning-Mail über
//         dieselbe mail-foundation, an den Admin) UND dispatched
//         mark-soft-warned
//   2. Inner Handler: createTransportForTenant → transport.send
//   3. Post-Success: increment-cap-Counter um 1
//
// **Beobachtbar im InMemory-Inbox** (mail-transport-inmemory):
//   - Die "echten" Newsletter-Mails (an event.payload.to)
//   - Die Soft-Hit-Warning-Mails (an admin@tenant.demo, beim ersten
//     überschreiten)
//
// **Tier-Switching:** über den config-key "newsletter:config:tier"
// (text, "free"/"pro"). Im echten Leben würde Stripe das setzen; im
// Demo macht's der TenantAdmin per config:write:set-Handler.

import {
  CapCounterHandlers,
  currentCalendarMonthStartIso,
  type SoftHitNotifier,
  withCapEnforcement,
} from "@kumiko/bundled-features/cap-counter";
import type { EmailMessage } from "@kumiko/bundled-features/channel-email";
import {
  createTransportForTenant,
  mailFoundationFeature,
} from "@kumiko/bundled-features/mail-foundation";
import {
  access,
  createTenantConfig,
  defineFeature,
  type HandlerContext,
  type WriteHandlerDef,
} from "@kumiko/framework/engine";
import { z } from "zod";
import { DEMO_TIER_MAP, TIER_NAMES, type TierName } from "./tier-map";

const FEATURE_NAME = "newsletter";
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
      ctx,
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
 * Hol den Tenant-Tier aus dem config-key. Default "free" wenn nicht
 * gesetzt — neue Tenants starten ohne Subscription auf der niedrigsten
 * Stufe. Whitelist-Filter via TIER_NAMES verhindert Tippos
 * ("Pro" / "Premium"), würden ja sonst silent zu free fallen.
 */
async function resolveTier(ctx: HandlerContext): Promise<TierName> {
  const raw = (await ctx.config?.("newsletter:config:tier")) as string | undefined;
  if (raw && (TIER_NAMES as readonly string[]).includes(raw)) {
    return raw as TierName;
  }
  return "free";
}

/** Notifier-Factory: bauen einen SoftHitNotifier der die Warnung über
 *  dieselbe mail-foundation an den Tenant-Admin schickt. */
function buildSoftHitNotifier(ctx: HandlerContext): SoftHitNotifier {
  return async (info) => {
    const transport = await createTransportForTenant(
      ctx,
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
  // Hard-deps: mail-foundation für Plugin-API + config für tier-Wahl +
  // cap-counter (transitiv via withCapEnforcement, aber explicit ist
  // klarer für boot-Validator-Errors).
  r.requires("config");
  r.requires("cap-counter");
  r.requires(mailFoundationFeature.name);

  // Tier-config-key. Tenant-Admin setzt's; default "free".
  r.config({
    keys: {
      tier: createTenantConfig("select", {
        default: "free",
        options: TIER_NAMES,
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin", "User"),
      }),
    },
  });

  r.writeHandler(wrappedSendHandler);
});

/** QN für den send-Handler — exportiert damit Tests + Clients ohne
 *  Hand-Ableitung zugreifen. */
export const NEWSLETTER_SEND_QN = "newsletter:write:send";
export const NEWSLETTER_TIER_CONFIG_KEY = "newsletter:config:tier";

/** Re-export der Cap-Konstante für Tests die direkt incrementen. */
export { CapCounterHandlers, NEWSLETTER_CAP };
