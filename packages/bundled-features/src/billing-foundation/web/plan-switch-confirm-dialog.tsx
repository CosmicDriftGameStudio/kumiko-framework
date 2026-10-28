import {
  useLocale,
  useMutation,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { formatMoney } from "@cosmicdrift/kumiko-renderer/web";
import { type ReactNode, useState } from "react";
import type { BillingPlansResult, PlanSwitchPreview } from "../types.ts";
import { CONSENT_TEXT_OUTDATED_CODE } from "./checkout-consent-dialog.tsx";
import { ConsentCheckboxes, ConsentLinks, useConsentFieldState } from "./consent-fields.tsx";
import { SubscriptionFoundationHandlers, SubscriptionFoundationQueries } from "./constants.ts";
import { resolveConsentLocale } from "./consumer-protection/consent-locale.ts";
import { intervalKey } from "./plan-price.ts";
import { recurringAmountsOf } from "./plan-switch-recurring.ts";

type ConsumerProtectionView = NonNullable<BillingPlansResult["consumerProtection"]>;

type PlanSwitchPreviewReply = {
  readonly preview: PlanSwitchPreview;
  readonly target: {
    readonly unitAmount: number;
    readonly currency: string;
    readonly interval: string | null;
    readonly intervalCount: number | null;
  };
};

export type PlanSwitchConfirmDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly tier: string;
  readonly fromPlanName: string;
  readonly toPlanName: string;
  readonly consumerProtection?: ConsumerProtectionView;
  readonly onApplied: () => void;
  readonly onConsentTextOutdated: () => void;
};

// kumiko-lint-ignore no-custom-primitives Uses usePrimitives().Modal internally, name is a billing domain action, not a primitive reimplementation
export function PlanSwitchConfirmDialog({
  open,
  onOpenChange,
  tier,
  fromPlanName,
  toPlanName,
  consumerProtection,
  onApplied,
  onConsentTextOutdated,
}: PlanSwitchConfirmDialogProps): ReactNode {
  const t = useTranslation();
  const locale = useLocale().locale();
  const { Modal, Text, Button, Banner } = usePrimitives();
  const previewQuery = useQuery<PlanSwitchPreviewReply>(
    SubscriptionFoundationQueries.planSwitchPreview,
    { tier },
  );
  const switchMutation = useMutation<{ readonly applied: true }>(
    SubscriptionFoundationHandlers.switchPlan,
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const consentLocale = resolveConsentLocale(locale);
  const texts = consumerProtection?.consentTexts[consentLocale];
  const legalLinks = consumerProtection?.legalLinks[consentLocale];
  const consentFields = useConsentFieldState(texts);
  const consentGiven = consumerProtection === undefined || consentFields.allGiven;

  async function confirm(): Promise<void> {
    setSubmitting(true);
    setErrorText(null);
    const consent = consentFields.buildPayload(consentLocale);
    const result = await switchMutation.mutate({ tier, ...(consent && { consent }) });
    if (result.isSuccess) {
      onApplied();
      return;
    }
    setSubmitting(false);
    setErrorText(t(result.error.i18nKey, result.error.i18nParams));
    if (result.error.code === CONSENT_TEXT_OUTDATED_CODE) {
      consentFields.reset();
      onConsentTextOutdated();
    }
  }

  const reply = previewQuery.data;
  const money = (amount: number, currency: string) => formatMoney(amount, currency, locale);
  const recurringKey = reply === null ? undefined : intervalKey(reply.target);
  const recurring = reply === null ? null : recurringAmountsOf(reply);
  const recurringPrice =
    reply === null || recurring === null
      ? ""
      : `${money(recurring.amount, recurring.currency)}${
          recurringKey === undefined
            ? ""
            : ` ${t(recurringKey, { count: new Intl.NumberFormat(locale).format(reply.target.intervalCount ?? 1) })}`
        }${
          recurring.tax === null
            ? ""
            : ` (${t("billing-foundation.planSwitch.includesTax", { tax: money(recurring.tax, recurring.currency) })})`
        }`;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("billing-foundation.planSwitch.title")}
      testId="plan-switch-confirm-dialog"
    >
      <div className="flex flex-col gap-4">
        <Text>
          {t("billing-foundation.planSwitch.summary", { from: fromPlanName, to: toPlanName })}
        </Text>
        {previewQuery.error !== null && (
          <Banner variant="error" testId="plan-switch-preview-error">
            {t(previewQuery.error.i18nKey, previewQuery.error.i18nParams)}
          </Banner>
        )}
        {previewQuery.loading && reply === null && (
          <Banner variant="loading" testId="plan-switch-preview-loading">
            {t("kumiko.widget.loading")}
          </Banner>
        )}
        {reply !== null && (
          <div className="flex flex-col gap-1" data-testid="plan-switch-summary">
            <Text>
              {t("billing-foundation.planSwitch.dueNow", {
                amount: money(reply.preview.amountDueNow, reply.preview.currency),
              })}
              {reply.preview.tax !== null &&
                ` (${t("billing-foundation.planSwitch.includesTax", {
                  tax: money(reply.preview.tax, reply.preview.currency),
                })})`}
            </Text>
            <Text variant="muted">
              {t("billing-foundation.planSwitch.credit", {
                amount: money(reply.preview.credit, reply.preview.currency),
              })}
            </Text>
            <Text variant="muted">
              {t("billing-foundation.planSwitch.recurring", {
                amount: recurringPrice,
              })}
            </Text>
            <Text variant="muted">{t("billing-foundation.planSwitch.effective")}</Text>
            <Text variant="muted">{t("billing-foundation.planSwitch.pendingNote")}</Text>
          </div>
        )}
        {legalLinks !== undefined && <ConsentLinks legalLinks={legalLinks} />}
        {texts !== undefined && (
          <ConsentCheckboxes
            idPrefix="plan-switch"
            texts={texts}
            state={consentFields}
            disabled={submitting}
          />
        )}
        {errorText !== null && (
          <Banner variant="error" testId="plan-switch-confirm-error">
            {errorText}
          </Banner>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
            testId="plan-switch-confirm-cancel"
          >
            {t("billing-foundation.consent.back")}
          </Button>
          <Button
            disabled={!consentGiven || reply === null || submitting}
            loading={submitting}
            onClick={confirm}
            testId="plan-switch-confirm-order"
          >
            {t("billing-foundation.planSwitch.order")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
