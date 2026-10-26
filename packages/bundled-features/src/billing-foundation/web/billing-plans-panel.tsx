import {
  type ExtensionSectionProps,
  useLocale,
  useMutation,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { toInstant, type WriteResult } from "@cosmicdrift/kumiko-renderer/headless";
import {
  formatMoney,
  PlanCard,
  type PlanCardActionSlot,
  PlanGrid,
} from "@cosmicdrift/kumiko-renderer/web";
import { type ReactNode, useState } from "react";
import type { BillingPlansResult, BillingPlanView } from "../types.ts";
import { BillingContactPlan } from "./billing-contact-plan.tsx";
import { CancelContractDialog } from "./cancel-contract-dialog.tsx";
import { CheckoutConsentDialog, type CheckoutConsentPayload } from "./checkout-consent-dialog.tsx";
import {
  BillingPlanActions,
  SubscriptionFoundationHandlers,
  SubscriptionFoundationQueries,
  SubscriptionStatuses,
} from "./constants.ts";
import { resolveConsentLocale } from "./consumer-protection/consent-locale.ts";
import { localizedParams } from "./localized-params.ts";
import { cheapestPrice, intervalKey, pricesDiffer, renewalKey, tierPrices } from "./plan-price.ts";
import { PlanSwitchConfirmDialog } from "./plan-switch-confirm-dialog.tsx";

type UseTranslation = ReturnType<typeof useTranslation>;

/** Which action the plan "would" offer if it weren't blocked — mirrors
 *  plan-catalog.ts's own decision tree, since `unavailable` collapses both
 *  "would checkout" and "would switch" into one action and the disabled CTA
 *  still needs the right label. */
function impliedAction(
  plan: BillingPlanView,
  subscription: BillingPlansResult["subscription"],
): "checkout" | "switch" {
  return subscription !== null && !subscription.terminal && plan.tier !== subscription.tier
    ? "switch"
    : "checkout";
}

/** Shared manage/reactivate secondaryAction for a current-tier card — used
 *  by both a catalog plan's own card (`isCurrent`) and the synthetic
 *  out-of-catalog current-tier card, so the two don't duplicate the
 *  cancelAt-aware label choice. */
function manageOrReactivateAction(
  canManage: boolean,
  subscription: BillingPlansResult["subscription"],
  t: UseTranslation,
  onManage: () => void,
  redirecting: boolean,
): PlanCardActionSlot | undefined {
  if (!canManage) return undefined;
  return {
    label: t(
      subscription?.cancelAt != null
        ? "billing-foundation.plans.reactivate"
        : "billing-foundation.plans.manage",
    ),
    onClick: onManage,
    disabled: redirecting,
  };
}

/** `!canPurchase` hides every CTA outright (see `purchaseNotAllowed`) — distinct
 *  from the `unavailable` action's disabled CTA, which still shows a button
 *  (for example, when a plan's price failed to load), so this check runs
 *  before the general unavailable fallback. */

function planCta(
  plan: BillingPlanView,
  result: BillingPlansResult,
  t: UseTranslation,
  onAction: (tier: string, kind: "checkout" | "switch") => void,
  redirecting: boolean,
): PlanCardActionSlot | undefined {
  if (plan.action === BillingPlanActions.current) return undefined;
  if (plan.action === BillingPlanActions.paymentPending) return undefined;
  if (!result.canPurchase) return undefined;

  const kind =
    plan.action === BillingPlanActions.switch ? "switch" : impliedAction(plan, result.subscription);
  const label = t(
    kind === "switch" ? "billing-foundation.plans.switch" : "billing-foundation.plans.choose",
    {
      plan: t(plan.labelKey),
    },
  );
  if (plan.action === BillingPlanActions.unavailable) {
    return { label, onClick: () => {}, disabled: true };
  }
  return {
    label,
    onClick: () => onAction(plan.tier, kind),
    disabled: redirecting,
  };
}

export function BillingPlansPanel(_props: ExtensionSectionProps): ReactNode {
  const t = useTranslation();
  const locale = useLocale().locale();
  const { Banner, Button } = usePrimitives();
  const query = useQuery<BillingPlansResult | null>(SubscriptionFoundationQueries.billingPlans, {});
  const checkoutMutation = useMutation<{ readonly url: string }>(
    SubscriptionFoundationHandlers.startPlanCheckout,
  );
  const switchMutation = useMutation<{ readonly url: string }>(
    SubscriptionFoundationHandlers.switchPlan,
  );
  const portalMutation = useMutation<{ readonly url: string }>(
    SubscriptionFoundationHandlers.createPortalSession,
  );

  // Single flag for every CTA + the manage-button: set on click, held through
  // a successful mutation (the tab is about to navigate away), reset only on
  // failure. Scoping "pending" per-button would leave the just-clicked button
  // enabled during its own in-flight request — a double-click risk — and
  // `mutation.pending` alone drops before `window.location.assign` completes.
  const [redirecting, setRedirecting] = useState(false);
  const [consentTier, setConsentTier] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [chosenProvider, setChosenProvider] = useState<string | null>(null);
  const [switchTier, setSwitchTier] = useState<string | null>(null);
  const [switchRequested, setSwitchRequested] = useState(false);

  // Only present when the tenant can choose (several offered providers) or
  // the single offered provider has a note; absent means the server decides.
  const providers = query.data?.providers;
  const activeProvider = providers?.find((p) => p.name === chosenProvider) ?? providers?.[0];
  const providerArg = activeProvider ? { providerName: activeProvider.name } : {};

  async function orderWithConsent(
    tier: string,
    consent: CheckoutConsentPayload | undefined,
  ): Promise<WriteResult<{ readonly url: string }>> {
    const result = await checkoutMutation.mutate({
      tier,
      ...(consent !== undefined && { consent }),
      ...providerArg,
    });
    if (result.isSuccess) {
      setRedirecting(true);
      window.location.assign(result.data.url);
    }
    return result;
  }

  async function handleAction(tier: string, kind: "checkout" | "switch"): Promise<void> {
    if (
      kind === "checkout" &&
      (query.data?.consumerProtection !== undefined || (providers?.length ?? 0) > 1)
    ) {
      setChosenProvider(null);
      setConsentTier(tier);
      return;
    }
    if (kind === "switch" && query.data?.inAppPlanSwitch) {
      setSwitchTier(tier);
      return;
    }
    setRedirecting(true);
    const result =
      kind === "checkout"
        ? await checkoutMutation.mutate({ tier, ...providerArg })
        : await switchMutation.mutate({ tier });
    if (result.isSuccess) {
      window.location.assign(result.data.url);
    } else {
      setRedirecting(false);
    }
  }

  async function handleManage(): Promise<void> {
    setRedirecting(true);
    const result = await portalMutation.mutate({});
    if (result.isSuccess) {
      window.location.assign(result.data.url);
    } else {
      setRedirecting(false);
    }
  }

  if (query.error !== null) {
    return (
      <Banner variant="error" testId="billing-plans-panel-error">
        {t(query.error.i18nKey, query.error.i18nParams)}
      </Banner>
    );
  }
  if (query.loading && !query.data) {
    return (
      <Banner variant="loading" testId="billing-plans-panel-loading">
        {t("kumiko.widget.loading")}
      </Banner>
    );
  }
  if (!query.data) return null;
  const result: BillingPlansResult = query.data;
  // Cards show the first provider's price; the dialog then follows the chosen one.
  const shownPlans = providers?.[0]?.plans ?? result.plans;
  const dialogPlans = activeProvider?.plans ?? result.plans;

  // The consent dialog shows the checkout error itself.
  const mutationError =
    (consentTier === null ? checkoutMutation.error : null) ??
    switchMutation.error ??
    portalMutation.error;
  const canManage =
    result.subscription !== null && !result.subscription.terminal && result.canPurchase;

  function toCardProps(plan: BillingPlanView) {
    const comparable =
      providers !== undefined && providers.length > 1 ? tierPrices(providers, plan.tier) : [];
    const fromPrice = pricesDiffer(comparable) ? cheapestPrice(comparable) : undefined;
    const shownPrice = fromPrice ?? plan.price;
    const key = intervalKey(shownPrice);
    return {
      title: t(plan.labelKey),
      description:
        plan.action === BillingPlanActions.paymentPending
          ? t("billing-foundation.plans.paymentPending")
          : undefined,
      current: plan.isCurrent,
      // Billing off means "no price to show", not "price failed to load" —
      // undefined drops the price row entirely, distinct from the `null`
      // price-unavailable state resolvePlanPrices returns for a genuine
      // provider lookup failure.
      price:
        !result.enabled && plan.isCurrent
          ? undefined
          : shownPrice === null
            ? null
            : {
                amount: formatMoney(shownPrice.unitAmount, shownPrice.currency, locale),
                ...(fromPrice !== undefined && { prefix: t("billing-foundation.plans.priceFrom") }),
                ...(result.priceNoteKey !== undefined && { note: t(result.priceNoteKey) }),
                ...(key !== undefined && {
                  period: t(key, {
                    count: new Intl.NumberFormat(locale).format(shownPrice.intervalCount ?? 1),
                  }),
                }),
              },
      features: plan.benefits.map((benefit) =>
        t(benefit.labelKey, localizedParams(benefit.params, locale)),
      ),
      cta: planCta(plan, result, t, handleAction, redirecting),
      secondaryAction: plan.isCurrent
        ? manageOrReactivateAction(canManage, result.subscription, t, handleManage, redirecting)
        : undefined,
    };
  }

  // The catalog's plans don't have to cover every tier a tenant can be on
  // (a legacy/free/pilot tier outside `catalog.plans`) — when none of the
  // rendered plans is the current one, a synthetic current-tier card (no
  // price, no cta) keeps it visible regardless of enabled/disabled.
  const consentPlan =
    consentTier !== null ? dialogPlans.find((plan) => plan.tier === consentTier) : undefined;
  const switchPlan =
    switchTier !== null ? shownPlans.find((plan) => plan.tier === switchTier) : undefined;
  const consumerProtection = result.consumerProtection;
  const noteLocale = resolveConsentLocale(locale);
  const noteOf = (provider: { readonly note?: Readonly<Record<string, string>> }) =>
    provider.note?.[noteLocale] ?? provider.note?.["en"];
  const singleProviderNote =
    providers !== undefined && providers.length === 1 && providers[0] !== undefined
      ? noteOf(providers[0])
      : undefined;
  function providerChoiceFor(tier: string) {
    if (providers === undefined || providers.length < 2 || activeProvider === undefined) {
      return undefined;
    }
    const prices = tierPrices(providers, tier);
    const showPrices = pricesDiffer(prices);
    return {
      value: activeProvider.name,
      onChange: setChosenProvider,
      options: providers.map((provider) => {
        const price = provider.plans.find((plan) => plan.tier === tier)?.price;
        const note = noteOf(provider);
        return {
          value: provider.name,
          title: provider.displayName,
          ...(note !== undefined && { description: note }),
          ...(showPrices &&
            price && { aside: formatMoney(price.unitAmount, price.currency, locale) }),
        };
      }),
    };
  }
  const currentTierInPlans = shownPlans.some((plan) => plan.isCurrent);
  const visiblePlans = result.enabled ? shownPlans : shownPlans.filter((plan) => plan.isCurrent);

  return (
    <div className="flex flex-col gap-4" data-testid="billing-plans-panel">
      {!result.enabled && (
        <Banner variant="info" testId="billing-plans-panel-disabled">
          {t("billing-foundation.plans.billingDisabled")}
        </Banner>
      )}
      {!result.canPurchase && (
        <Banner variant="warning" testId="billing-plans-panel-readonly">
          {t("billing-foundation.plans.purchaseNotAllowed")}
        </Banner>
      )}
      {switchRequested && (
        <Banner variant="info" testId="billing-plans-panel-switch-requested">
          {t("billing-foundation.plans.planSwitchRequested")}
        </Banner>
      )}
      {mutationError !== null && (
        <Banner variant="error" testId="billing-plans-panel-mutation-error">
          {t(mutationError.i18nKey, mutationError.i18nParams)}
        </Banner>
      )}
      {result.subscription?.status === SubscriptionStatuses.pastDue && (
        <Banner variant="warning" testId="billing-plans-panel-past-due">
          {t("billing-foundation.plans.pastDue")}
        </Banner>
      )}
      {result.subscription !== null &&
        !result.subscription.terminal &&
        result.subscription.cancelAt != null && (
          <Banner variant="info" testId="billing-plans-panel-cancel-scheduled">
            {t("billing-foundation.plans.cancelScheduled", {
              date: toInstant(result.subscription.cancelAt).toLocaleString(locale, {
                dateStyle: "medium",
              }),
            })}{" "}
            {t("billing-foundation.plans.switchRequiresReactivation")}
          </Banner>
        )}
      {consumerProtection !== undefined && canManage && result.subscription?.cancelAt == null && (
        <div>
          <Button
            variant="secondary"
            onClick={() => setCancelOpen(true)}
            testId="billing-plans-cancel-contract"
          >
            {t("billing-foundation.cancel.open")}
          </Button>
        </div>
      )}
      <PlanGrid testId="billing-plans-grid">
        {!currentTierInPlans && (
          <PlanCard
            title={t(result.currentTier.labelKey)}
            current
            testId="billing-plan-card-current"
            features={result.currentTier.benefits.map((benefit) =>
              t(benefit.labelKey, localizedParams(benefit.params, locale)),
            )}
            secondaryAction={manageOrReactivateAction(
              canManage,
              result.subscription,
              t,
              handleManage,
              redirecting,
            )}
          />
        )}
        {visiblePlans.map((plan) => (
          <PlanCard
            key={plan.tier}
            testId={`billing-plan-card-${plan.tier}`}
            {...toCardProps(plan)}
          />
        ))}
        {result.contact !== undefined && <BillingContactPlan contact={result.contact} />}
      </PlanGrid>
      {consentPlan !== undefined && consentPlan.price !== null && (
        <CheckoutConsentDialog
          open
          onOpenChange={(open) => {
            if (!open) setConsentTier(null);
          }}
          planName={t(consentPlan.labelKey)}
          price={{
            amount: formatMoney(consentPlan.price.unitAmount, consentPlan.price.currency, locale),
            renewalKey: renewalKey(consentPlan.price),
            count: new Intl.NumberFormat(locale).format(consentPlan.price.intervalCount ?? 1),
          }}
          consumerProtection={consumerProtection}
          providerChoice={providerChoiceFor(consentPlan.tier)}
          note={singleProviderNote}
          onOrder={(consent) => orderWithConsent(consentPlan.tier, consent)}
          onConsentTextOutdated={() => void query.refetch()}
        />
      )}
      {switchPlan !== undefined && (
        <PlanSwitchConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setSwitchTier(null);
          }}
          tier={switchPlan.tier}
          fromPlanName={t(result.currentTier.labelKey)}
          toPlanName={t(switchPlan.labelKey)}
          consumerProtection={consumerProtection}
          onApplied={() => {
            setSwitchTier(null);
            setSwitchRequested(true);
            void query.refetch();
          }}
          onConsentTextOutdated={() => void query.refetch()}
        />
      )}
      {consumerProtection !== undefined && canManage && (
        <CancelContractDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          onTerminated={() => void query.refetch()}
        />
      )}
    </div>
  );
}
