// @runtime client

import type { WriteResult } from "@cosmicdrift/kumiko-headless";
import { useLocale, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { resolveConsentLocale } from "../consumer-protection/consent-locale.js";
import type { BillingPlansResult } from "../types.js";

export const CONSENT_TEXT_OUTDATED_CODE = "consent_text_outdated";

type ConsumerProtectionView = NonNullable<BillingPlansResult["consumerProtection"]>;

export type CheckoutConsentPayload = {
  readonly earlyPerformanceRequested: true;
  readonly withdrawalLossAcknowledged: true;
  readonly consentTextVersion: string;
  readonly locale: string;
};

export type CheckoutConsentDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly planName: string;
  readonly price: { readonly amount: string; readonly renewalKey?: string; readonly count: string };
  readonly consumerProtection: ConsumerProtectionView;
  readonly onOrder: (consent: CheckoutConsentPayload) => Promise<WriteResult<{ url: string }>>;
  readonly onConsentTextOutdated: () => void;
};

// kumiko-lint-ignore no-custom-primitives Uses usePrimitives().Modal internally, name is a billing domain action, not a primitive reimplementation
export function CheckoutConsentDialog({
  open,
  onOpenChange,
  planName,
  price,
  consumerProtection,
  onOrder,
  onConsentTextOutdated,
}: CheckoutConsentDialogProps): ReactNode {
  const t = useTranslation();
  const uiLocale = useLocale().locale();
  const { Modal, Heading, Text, Field, Input, Button, Link, Banner } = usePrimitives();
  const [earlyPerformance, setEarlyPerformance] = useState(false);
  const [withdrawalLoss, setWithdrawalLoss] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const consentLocale = resolveConsentLocale(uiLocale);
  const texts = consumerProtection.consentTexts[consentLocale];
  const { legalLinks } = consumerProtection;

  async function order(): Promise<void> {
    setSubmitting(true);
    setErrorText(null);
    const result = await onOrder({
      earlyPerformanceRequested: true,
      withdrawalLossAcknowledged: true,
      consentTextVersion: texts.consentTextVersion,
      locale: consentLocale,
    });
    if (result.isSuccess) return;
    setSubmitting(false);
    setErrorText(t(result.error.i18nKey, result.error.i18nParams));
    if (result.error.code === CONSENT_TEXT_OUTDATED_CODE) {
      setEarlyPerformance(false);
      setWithdrawalLoss(false);
      onConsentTextOutdated();
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("billing-foundation.consent.title")}
      testId="checkout-consent-dialog"
    >
      <div className="flex flex-col gap-4">
        <Heading variant="page">{t("billing-foundation.consent.title")}</Heading>
        <div className="flex flex-col gap-1" data-testid="checkout-consent-summary">
          <Text>
            {planName} — {price.amount}
          </Text>
          {price.renewalKey !== undefined && (
            <Text variant="muted">{t(price.renewalKey, { count: price.count })}</Text>
          )}
          <Text variant="muted">{t("billing-foundation.consent.cancelAnytime")}</Text>
        </div>
        <div className="flex flex-wrap gap-4">
          <Link href={legalLinks.terms} target="_blank">
            {t("billing-foundation.consent.link.terms")}
          </Link>
          <Link href={legalLinks.withdrawal} target="_blank">
            {t("billing-foundation.consent.link.withdrawal")}
          </Link>
          <Link href={legalLinks.privacy} target="_blank">
            {t("billing-foundation.consent.link.privacy")}
          </Link>
        </div>
        <Field id="consent-early-performance" label={texts.earlyPerformance} layout="inline">
          <Input
            kind="boolean"
            id="consent-early-performance"
            name="consent-early-performance"
            value={earlyPerformance}
            onChange={setEarlyPerformance}
            disabled={submitting}
          />
        </Field>
        <Field id="consent-withdrawal-loss" label={texts.withdrawalLoss} layout="inline">
          <Input
            kind="boolean"
            id="consent-withdrawal-loss"
            name="consent-withdrawal-loss"
            value={withdrawalLoss}
            onChange={setWithdrawalLoss}
            disabled={submitting}
          />
        </Field>
        {errorText !== null && (
          <Banner variant="error" testId="checkout-consent-error">
            {errorText}
          </Banner>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
            testId="checkout-consent-cancel"
          >
            {t("billing-foundation.consent.back")}
          </Button>
          <Button
            disabled={!earlyPerformance || !withdrawalLoss || submitting}
            loading={submitting}
            onClick={order}
            testId="checkout-consent-order"
          >
            {t("billing-foundation.consent.order")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
