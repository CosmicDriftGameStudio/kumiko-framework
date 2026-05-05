// createSubscriptionWebhookHandler — Hono-route-factory den der App-
// Owner via `extraRoutes` in seinem bin/server.ts mountet.
//
// **Multi-Provider:** der Plugin wird via Pfad-Parameter
// `:providerName` ausgewählt — Stripe-Dashboard zeigt auf
// `/api/subscription/webhook/stripe`, PayPal auf
// `/api/subscription/webhook/paypal`. Eine Hono-Route, alle Plugins
// gleichzeitig aktiv.
//
// Beispiel-Verwendung in bin/server.ts:
//
//   await runDevApp({
//     features: APP_FEATURES,
//     extraRoutes: (app, deps) => {
//       const handler = createSubscriptionWebhookHandler(deps);
//       app.post("/api/subscription/webhook/:providerName", handler);
//     },
//   });
//
// Was der handler macht:
//   1. providerName aus dem URL-Pfad lesen
//   2. raw-body via c.req.text() lesen (NICHT JSON-parsen — Stripe-Sig
//      prüft exakte bytes)
//   3. Headers sammeln + an Plugin durchreichen
//   4. Plugin-Lookup im Registry via "subscriptionProvider"-extension
//      und dem providerName aus dem URL-Pfad
//   5. plugin.verifyAndParseWebhook(raw, headers, ctx) → SubscriptionEvent | null
//   6. Bei null (= Plugin filtert event-type raus): 200 OK ohne side-effects
//   7. Bei Event: ctx.write("billing-foundation:write:process-event")
//      mit der vom Plugin aufgelösten tenantId
//   8. Returnt 200 OK an Provider
//
// **Auth:** kein JWT/Cookie. Authentifizierung läuft via Provider-
// Webhook-Sig im Plugin. Kein `c.get("user")`-call hier.

import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { Context, Hono } from "hono";
import {
  BILLING_FOUNDATION_FEATURE,
  SUBSCRIPTION_PROVIDER_EXTENSION,
  SubscriptionFoundationHandlers,
} from "./constants";
import type { SubscriptionProviderPlugin } from "./types";

/**
 * Dependencies the App-Owner gibt dem webhook-handler. Identisch zum
 * `extraRoutes`-Callback-Argument-shape von runDevApp/runProdApp.
 */
export type SubscriptionWebhookDeps = {
  /** Schreibt durch den Standard-Dispatcher mit einem auto-konstruierten
   *  SystemUser. Muss `process-event` als SystemAdmin durchlassen. */
  readonly dispatchWrite: (args: {
    readonly handlerQn: string;
    readonly payload: unknown;
    readonly tenantId: string;
  }) => Promise<{
    readonly isSuccess: boolean;
    readonly data?: unknown;
    readonly error?: unknown;
  }>;

  /** Plugin-Lookup-Function — bekommt den providerName aus dem URL-
   *  Pfad und returnt den passenden Plugin (= entityName-match in
   *  registry.getExtensionUsages("subscriptionProvider")). */
  readonly resolveProvider: (providerName: string) => SubscriptionProviderPlugin | undefined;
};

/**
 * Returnt einen Hono-handler. Mounten via
 * `app.post("/api/subscription/webhook/:providerName", handler)`.
 */
export function createSubscriptionWebhookHandler(deps: SubscriptionWebhookDeps) {
  return async (c: Context): Promise<Response> => {
    // 1. providerName aus URL-Pfad. Hono-Standard via c.req.param.
    const providerName = c.req.param("providerName");
    if (!providerName || providerName.length === 0) {
      return c.json(
        {
          error: {
            code: "subscription_provider_path_missing",
            message: `${BILLING_FOUNDATION_FEATURE}: Mount the route as POST /api/subscription/webhook/:providerName so each provider has its own URL (Stripe-Dashboard → /stripe, PayPal-Dashboard → /paypal).`,
          },
        },
        400,
      );
    }

    // 2. Raw-body. Provider-Sigs werden gegen die exakten bytes verifiziert.
    const rawBody = await c.req.text();
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // 3. Plugin-Lookup via path-segment. Jeder gemountete Plugin hat
    //    sich mit `r.useExtension("subscriptionProvider", entityName,
    //    {...})` registriert; entityName matcht hier den path-segment.
    const plugin = deps.resolveProvider(providerName);
    if (!plugin) {
      return c.json(
        {
          error: {
            code: "subscription_provider_not_registered",
            message: `${BILLING_FOUNDATION_FEATURE}: provider "${providerName}" not registered as '${SUBSCRIPTION_PROVIDER_EXTENSION}'-plugin. Mount the matching subscription-${providerName} feature.`,
          },
        },
        404,
      );
    }

    // 4. Plugin verifies + parses. **Pre-tenant-resolution** — kein
    //    ctx, Plugin liest seinen webhook-secret aus eigener
    //    module-load-Closure (ENV-VAR oder system-config).
    //    Throws on sig-mismatch — wir mappen auf 401 (= "config-bug,
    //    retry won't help, Provider stopp").
    let parsed: Awaited<ReturnType<SubscriptionProviderPlugin["verifyAndParseWebhook"]>>;
    try {
      parsed = await plugin.verifyAndParseWebhook(rawBody, headers);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json(
        {
          error: {
            code: "subscription_webhook_signature_invalid",
            message: `Plugin "${providerName}" rejected webhook: ${msg}`,
          },
        },
        401,
      );
    }

    // 5. Plugin returned null = "ich kenne diesen event-type nicht / ist
    //    nicht relevant". 200 OK damit der Provider keine retries macht.
    if (parsed === null) {
      return c.json({ ignored: true }, 200);
    }

    // 6. Dispatch process-event-handler durch den Standard-Dispatcher.
    //    Idempotency macht der handler intern via deterministic
    //    aggregate-id + UNIQUE-constraint.
    const dispatched = await deps.dispatchWrite({
      handlerQn: SubscriptionFoundationHandlers.processEvent,
      tenantId: parsed.tenantId,
      payload: {
        providerEventId: parsed.providerEventId,
        providerName: parsed.providerName,
        type: parsed.type,
        providerCustomerId: parsed.providerCustomerId,
        providerSubscriptionId: parsed.providerSubscriptionId,
        status: parsed.status,
        tier: parsed.tier,
        currentPeriodEndIso: parsed.currentPeriodEnd,
        rawPayload: parsed.rawPayload,
      },
    });

    if (!dispatched.isSuccess) {
      // Internal error — Provider soll retry'n. 500 statt 401/404 weil
      // das transient ist (DB down etc.) nicht config-bug.
      return c.json(
        {
          error: {
            code: "subscription_webhook_processing_failed",
            message: "Internal error processing subscription event",
            details: dispatched.error,
          },
        },
        500,
      );
    }

    return c.json({ processed: true, ...((dispatched.data as object) ?? {}) }, 200);
  };
}

/**
 * Convenience für TypeScript-IDE: `Hono.post(...)`-Call-Type damit der
 * App-Owner-Code typed bleibt ohne Hono-types zu importieren.
 */
export type SubscriptionWebhookHandler = ReturnType<typeof createSubscriptionWebhookHandler>;

// Re-export für convenience: App-Owner kann den TenantId-type aus dem
// gleichen Modul importieren (vermeidet ein zweites Framework-import).
export type { Hono, TenantId };
