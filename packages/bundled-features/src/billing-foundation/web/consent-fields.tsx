import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import type { BillingPlansResult, LegalLinkSet } from "../types.ts";
import type { CheckoutConsentPayload } from "./checkout-consent-dialog.tsx";

type ConsumerProtectionView = NonNullable<BillingPlansResult["consumerProtection"]>;
export type ConsentTextView = ConsumerProtectionView["consentTexts"]["de"];

export type ConsentChecks = {
  readonly documentsAcknowledged: boolean;
  readonly earlyPerformance: boolean;
  readonly withdrawalLoss: boolean;
};

const NOTHING_CHECKED: ConsentChecks = {
  documentsAcknowledged: false,
  earlyPerformance: false,
  withdrawalLoss: false,
};

export type ConsentFieldState = {
  readonly checks: ConsentChecks;
  readonly setCheck: (key: keyof ConsentChecks, value: boolean) => void;
  readonly reset: () => void;
  readonly allGiven: boolean;
  readonly buildPayload: (locale: string) => CheckoutConsentPayload | undefined;
};

export function useConsentFieldState(texts: ConsentTextView | undefined): ConsentFieldState {
  const [checks, setChecks] = useState<ConsentChecks>(NOTHING_CHECKED);
  const documentsRequired = texts?.documentsAcknowledgement !== undefined;
  return {
    checks,
    setCheck: (key, value) => setChecks((current) => ({ ...current, [key]: value })),
    reset: () => setChecks(NOTHING_CHECKED),
    allGiven:
      checks.earlyPerformance &&
      checks.withdrawalLoss &&
      (!documentsRequired || checks.documentsAcknowledged),
    buildPayload: (locale) =>
      texts === undefined
        ? undefined
        : {
            earlyPerformanceRequested: true,
            withdrawalLossAcknowledged: true,
            ...(documentsRequired && { documentsAcknowledged: true }),
            consentTextVersion: texts.consentTextVersion,
            locale,
          },
  };
}

export function ConsentLinks({ legalLinks }: { readonly legalLinks: LegalLinkSet }): ReactNode {
  const t = useTranslation();
  const { Link } = usePrimitives();
  return (
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
      {legalLinks.refund !== undefined && (
        <Link href={legalLinks.refund} target="_blank">
          {t("billing-foundation.consent.link.refund")}
        </Link>
      )}
    </div>
  );
}

export function ConsentCheckboxes({
  idPrefix,
  texts,
  state,
  disabled,
}: {
  readonly idPrefix: string;
  readonly texts: ConsentTextView;
  readonly state: ConsentFieldState;
  readonly disabled: boolean;
}): ReactNode {
  const { Field, Input } = usePrimitives();
  const boxes: readonly { key: keyof ConsentChecks; slug: string; label: string | undefined }[] = [
    { key: "documentsAcknowledged", slug: "documents", label: texts.documentsAcknowledgement },
    { key: "earlyPerformance", slug: "early-performance", label: texts.earlyPerformance },
    { key: "withdrawalLoss", slug: "withdrawal-loss", label: texts.withdrawalLoss },
  ];
  return (
    <>
      {boxes.map(({ key, slug, label }) =>
        label === undefined ? null : (
          <Field key={key} id={`${idPrefix}-${slug}`} label={label} layout="inline">
            <Input
              kind="boolean"
              id={`${idPrefix}-${slug}`}
              name={`${idPrefix}-${slug}`}
              value={state.checks[key]}
              onChange={(value) => state.setCheck(key, value)}
              disabled={disabled}
            />
          </Field>
        ),
      )}
    </>
  );
}
