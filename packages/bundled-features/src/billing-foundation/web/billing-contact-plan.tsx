// @runtime client

import { useLocale, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { PlanCard } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import { isContactCardHref } from "../contact-card.ts";
import type { BillingPlanContactCard } from "../types.ts";
import { localizedParams } from "./localized-params.ts";

export function BillingContactPlan({
  contact,
}: {
  readonly contact: BillingPlanContactCard;
}): ReactNode {
  const t = useTranslation();
  const locale = useLocale().locale();
  if (!isContactCardHref(contact.href)) return null;
  return (
    <PlanCard
      title={t(contact.labelKey)}
      features={contact.benefits.map((benefit) =>
        t(benefit.labelKey, localizedParams(benefit.params, locale)),
      )}
      ctaLink={{
        label: t(contact.actionLabelKey),
        href: contact.href,
        target: new URL(contact.href).protocol === "https:" ? "_blank" : undefined,
      }}
      testId="billing-plan-card-contact"
    />
  );
}
