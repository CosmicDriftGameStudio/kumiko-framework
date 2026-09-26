// @runtime client
import {
  type ExtensionSectionProps,
  useLocale,
  useMutation,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import {
  formatMoney,
  PlanCard,
  type PlanCardActionSlot,
  PlanGrid,
} from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useState } from "react";
import {
  BillingPlanActions,
  SubscriptionFoundationHandlers,
  SubscriptionFoundationQueries,
} from "../constants";
import type { BillingPlansResult, BillingPlanView } from "../types";

type UseTranslation = ReturnType<typeof useTranslation>;

function intervalKey(price: BillingPlanView["price"]): string | undefined {
  if (price === null || price.interval === null) return undefined;
  return price.intervalCount !== null && price.intervalCount > 1
    ? `billing-foundation.plans.everyInterval.${price.interval}`
    : `billing-foundation.plans.perInterval.${price.interval}`;
}

function localizedParams(
  params: Readonly<Record<string, string | number>> | undefined,
  locale: string,
): Readonly<Record<string, string>> | undefined {
  if (params === undefined) return undefined;
  const localized: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    localized[key] =
      typeof value === "number" ? new Intl.NumberFormat(locale).format(value) : value;
  }
  return localized;
}

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

/** `!canPurchase` hides every CTA outright (spec: "keine CTAs, Hinweis
 *  purchaseNotAllowed") — distinct from the `unavailable` action's disabled
 *  CTA, which still shows a button (e.g. for a plan whose price failed to
 *  load) so this check runs before the general unavailable-fallback. */
function planCta(
  plan: BillingPlanView,
  result: BillingPlansResult,
  t: UseTranslation,
  onAction: (tier: string, kind: "checkout" | "switch") => void,
  redirecting: boolean,
): PlanCardActionSlot | undefined {
  if (plan.action === BillingPlanActions.current) return undefined;
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
  const { Banner } = usePrimitives();
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

  async function handleAction(tier: string, kind: "checkout" | "switch"): Promise<void> {
    setRedirecting(true);
    const mutation = kind === "checkout" ? checkoutMutation : switchMutation;
    const result = await mutation.mutate({ tier });
    if (result.isSuccess) {
      window.location.assign(result.data.url);
    } else {
      setRedirecting(false);
    }
  }

  async function handleManage(): Promise<void> {
    setRedirecting(true);
    const result = await portalMutation.mutate({ returnUrl: window.location.href });
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

  const mutationError = checkoutMutation.error ?? switchMutation.error ?? portalMutation.error;
  const canManage =
    result.subscription !== null && !result.subscription.terminal && result.canPurchase;

  function toCardProps(plan: BillingPlanView) {
    const key = intervalKey(plan.price);
    return {
      title: t(plan.labelKey),
      current: plan.isCurrent,
      // Billing off means "no price to show", not "price failed to load" —
      // undefined drops the price row entirely, distinct from the `null`
      // price-unavailable state resolvePlanPrices returns for a genuine
      // provider lookup failure.
      price:
        !result.enabled && plan.isCurrent
          ? undefined
          : plan.price === null
            ? null
            : {
                amount: formatMoney(plan.price.unitAmount, plan.price.currency, locale),
                ...(key !== undefined && {
                  period: t(key, {
                    count: new Intl.NumberFormat(locale).format(plan.price.intervalCount ?? 1),
                  }),
                }),
              },
      features: plan.benefits.map((benefit) =>
        t(benefit.labelKey, localizedParams(benefit.params, locale)),
      ),
      cta: planCta(plan, result, t, handleAction, redirecting),
      secondaryAction:
        plan.isCurrent && canManage
          ? {
              label: t("billing-foundation.plans.manage"),
              onClick: handleManage,
              disabled: redirecting,
            }
          : undefined,
    };
  }

  // The catalog's plans don't have to cover every tier a tenant can be on
  // (a legacy/free/pilot tier outside `catalog.plans`) — when none of the
  // rendered plans is the current one, a synthetic current-tier card (no
  // price, no cta) keeps it visible regardless of enabled/disabled.
  const currentTierInPlans = result.plans.some((plan) => plan.isCurrent);
  const visiblePlans = result.enabled
    ? result.plans
    : result.plans.filter((plan) => plan.isCurrent);

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
      {mutationError !== null && (
        <Banner variant="error" testId="billing-plans-panel-mutation-error">
          {t(mutationError.i18nKey, mutationError.i18nParams)}
        </Banner>
      )}
      <PlanGrid testId="billing-plans-grid">
        {!currentTierInPlans && (
          <PlanCard
            title={t(result.currentTier.labelKey)}
            current
            testId="billing-plan-card-current"
          />
        )}
        {visiblePlans.map((plan) => (
          <PlanCard
            key={plan.tier}
            testId={`billing-plan-card-${plan.tier}`}
            {...toCardProps(plan)}
          />
        ))}
      </PlanGrid>
    </div>
  );
}
