import { useLocale, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { WriteResult } from "@cosmicdrift/kumiko-renderer/headless";
import { ChoiceCards } from "@cosmicdrift/kumiko-renderer/web";
import { type ReactNode, useState } from "react";
import type { BillingPlansResult } from "../types.ts";
import { ConsentCheckboxes, ConsentLinks, useConsentFieldState } from "./consent-fields.tsx";
import { resolveConsentLocale } from "./consumer-protection/consent-locale.ts";

export const CONSENT_TEXT_OUTDATED_CODE = "consent_text_outdated";

type ConsumerProtectionView = NonNullable<BillingPlansResult["consumerProtection"]>;

export type CheckoutConsentPayload = {
  readonly earlyPerformanceRequested: true;
  readonly withdrawalLossAcknowledged: true;
  readonly documentsAcknowledged?: true;
  readonly consentTextVersion: string;
  readonly locale: string;
};

export type CheckoutConsentDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly planName: string;
  readonly price: {
    readonly amount: string;
    readonly renewalKey?: string;
    readonly count?: string;
  };
  /** Without it the dialog shows no legal links and no consent checkboxes and orders without a consent. */
  readonly consumerProtection?: ConsumerProtectionView;
  /** Several providers to pick from; the parent follows `value` for price and order. */
  readonly providerChoice?: {
    readonly options: readonly {
      readonly value: string;
      readonly title: string;
      readonly description?: string;
      readonly aside?: string;
    }[];
    readonly value: string;
    readonly onChange: (value: string) => void;
  };
  /** Provider note under the price line when there is no provider choice. */
  readonly note?: string;
  readonly onOrder: (
    consent: CheckoutConsentPayload | undefined,
  ) => Promise<WriteResult<{ url: string }>>;
  readonly onConsentTextOutdated: () => void;
};

// kumiko-lint-ignore no-custom-primitives Uses usePrimitives().Modal internally, name is a billing domain action, not a primitive reimplementation
export function CheckoutConsentDialog({
  open,
  onOpenChange,
  planName,
  price,
  consumerProtection,
  providerChoice,
  note,
  onOrder,
  onConsentTextOutdated,
}: CheckoutConsentDialogProps): ReactNode {
  const t = useTranslation();
  const uiLocale = useLocale().locale();
  const { Modal, Text, Button, Banner } = usePrimitives();
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const consentLocale = resolveConsentLocale(uiLocale);
  const texts = consumerProtection?.consentTexts[consentLocale];
  const legalLinks = consumerProtection?.legalLinks[consentLocale];
  const consentFields = useConsentFieldState(texts);
  const consentGiven = consumerProtection === undefined || consentFields.allGiven;

  async function order(): Promise<void> {
    setSubmitting(true);
    setErrorText(null);
    const result = await onOrder(consentFields.buildPayload(consentLocale));
    if (result.isSuccess) return;
    setSubmitting(false);
    setErrorText(t(result.error.i18nKey, result.error.i18nParams));
    if (result.error.code === CONSENT_TEXT_OUTDATED_CODE) {
      consentFields.reset();
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
        {providerChoice !== undefined && (
          <div className="flex flex-col gap-2">
            <Text variant="muted">{t("billing-foundation.consent.chooseProvider")}</Text>
            <ChoiceCards
              value={providerChoice.value}
              options={providerChoice.options}
              onChange={providerChoice.onChange}
              ariaLabel={t("billing-foundation.consent.chooseProvider")}
              testId="checkout-provider-choice"
            />
          </div>
        )}
        <div className="flex flex-col gap-1" data-testid="checkout-consent-summary">
          <Text>
            {planName} — {price.amount}
          </Text>
          {price.renewalKey !== undefined && (
            <>
              <Text variant="muted">
                {t(
                  price.renewalKey,
                  price.count !== undefined ? { count: price.count } : undefined,
                )}
              </Text>
              <Text variant="muted">{t("billing-foundation.consent.cancelAnytime")}</Text>
            </>
          )}
          {note !== undefined && (
            <Text variant="muted" testId="checkout-consent-note">
              {note}
            </Text>
          )}
        </div>
        {legalLinks !== undefined && <ConsentLinks legalLinks={legalLinks} />}
        {texts !== undefined && (
          <ConsentCheckboxes
            idPrefix="consent"
            texts={texts}
            state={consentFields}
            disabled={submitting}
          />
        )}
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
            disabled={!consentGiven || submitting}
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
