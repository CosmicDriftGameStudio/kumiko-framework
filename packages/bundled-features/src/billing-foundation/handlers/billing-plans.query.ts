// billing-plans — lists the catalog's purchasable plans with live price,
// benefits, the caller's current tier and per-plan action. Only registered
// when `createBillingFoundationFeature` gets a `catalog`.

import type { HandlerContext, QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import {
  filterOfferedProviders,
  listCatalogProviders,
  type ResolvedProvider,
} from "../checkout-core.ts";
import {
  type CONSENT_LOCALES,
  CONSENT_TEXTS,
  consentTextVersion,
  documentsAcknowledgementTextFor,
  hasProviderRefundLink,
  legalLinksFor,
} from "../consumer-protection/consent-text.ts";
import {
  type BillingPlansBase,
  buildProviderPlanViews,
  loadBillingPlansBase,
  type ProviderPlanViews,
  toBillingPlansResult,
} from "../plan-catalog.ts";
import type {
  BillingConsumerProtectionView,
  BillingPlanCatalog,
  BillingPlansResult,
  BillingProviderView,
  ConsumerProtectionOptions,
  ResolvedBillingFoundationOptions,
} from "../types.ts";

const billingPlansSchema = z.object({}).strict();

export function createBillingPlansQuery(
  options: ResolvedBillingFoundationOptions,
  catalog: BillingPlanCatalog,
): QueryHandlerDef {
  return {
    name: "billing-plans",
    description:
      "Lists the purchasable plans with live price, benefits, the caller's current tier and which action (checkout | switch | current | unavailable | paymentPending) each plan offers, plus the optional price-less contact card. With several live providers it also lists each provider's own plans under `providers`.",
    schema: billingPlansSchema,
    access: { roles: catalog.viewRoles },
    handler: async (_query, ctx): Promise<BillingPlansResult> => {
      const base = await loadBillingPlansBase(ctx, catalog, options.now);
      const result = await resolveProviderPlans(ctx, options, catalog, base);
      const { consumerProtection } = options;
      if (!consumerProtection) return result;
      return {
        ...result,
        consumerProtection: consumerProtectionView(
          consumerProtection,
          base.blockingSubscription ? base.subscriptionView?.providerName : undefined,
        ),
      };
    },
  };
}

// A tenant with a blocking subscription sees only the provider holding it
// (a second provider's prices would be a checkout it cannot start); otherwise
// every live provider is offered.
async function resolveProviderPlans(
  ctx: HandlerContext,
  options: ResolvedBillingFoundationOptions,
  catalog: BillingPlanCatalog,
  base: BillingPlansBase,
): Promise<BillingPlansResult> {
  const candidates = listCatalogProviders(ctx, catalog);
  if (base.blockingSubscription && base.subscriptionView) {
    const holder = candidates.find((c) => c.name === base.subscriptionView?.providerName);
    return toBillingPlansResult(
      catalog,
      base,
      await buildProviderPlanViews(ctx, holder?.plugin ?? null, catalog, base),
    );
  }

  const offered = await filterOfferedProviders(ctx, candidates);
  const first = offered[0] ?? candidates[0] ?? null;
  const firstViews = await buildProviderPlanViews(ctx, first?.plugin ?? null, catalog, base);
  const result = toBillingPlansResult(catalog, base, firstViews);

  const providerTexts = options.consumerProtection?.providerTexts;
  const hasProviderSpecifics =
    first !== null &&
    (providerTexts?.[first.name]?.checkoutNote !== undefined ||
      (options.consumerProtection !== undefined &&
        hasProviderRefundLink(options.consumerProtection, first.name)));
  if (offered.length <= 1 && !(offered.length === 1 && hasProviderSpecifics)) return result;

  const providers = await Promise.all(
    offered.map((provider, index) =>
      providerView(
        ctx,
        catalog,
        base,
        provider,
        options.consumerProtection,
        index === 0 ? firstViews : null,
      ),
    ),
  );
  return { ...result, providers };
}

async function providerView(
  ctx: HandlerContext,
  catalog: BillingPlanCatalog,
  base: BillingPlansBase,
  provider: ResolvedProvider,
  consumerProtection: ConsumerProtectionOptions | undefined,
  known: ProviderPlanViews | null,
): Promise<BillingProviderView> {
  const views = known ?? (await buildProviderPlanViews(ctx, provider.plugin, catalog, base));
  const note = consumerProtection?.providerTexts?.[provider.name]?.checkoutNote;
  const ownConsumerProtection =
    consumerProtection !== undefined && hasProviderRefundLink(consumerProtection, provider.name)
      ? consumerProtectionView(consumerProtection, provider.name)
      : undefined;
  return {
    name: provider.name,
    displayName: provider.plugin.displayName ?? provider.name,
    ...(note !== undefined && { note }),
    ...(ownConsumerProtection !== undefined && { consumerProtection: ownConsumerProtection }),
    plans: views.plans,
  };
}

function consumerProtectionView(
  consumerProtection: ConsumerProtectionOptions,
  providerName?: string,
): BillingConsumerProtectionView {
  return {
    consentTexts: {
      de: consentTextView(consumerProtection, "de", providerName),
      en: consentTextView(consumerProtection, "en", providerName),
    },
    legalLinks: legalLinksFor(consumerProtection, providerName),
  };
}

function consentTextView(
  consumerProtection: ConsumerProtectionOptions,
  locale: (typeof CONSENT_LOCALES)[number],
  providerName?: string,
) {
  const { earlyPerformance, withdrawalLoss } = CONSENT_TEXTS[locale];
  const documentsAcknowledgement = documentsAcknowledgementTextFor(
    consumerProtection,
    locale,
    providerName,
  );
  return {
    earlyPerformance,
    withdrawalLoss,
    ...(documentsAcknowledgement !== undefined && { documentsAcknowledgement }),
    consentTextVersion: consentTextVersion(locale, documentsAcknowledgement),
  };
}
