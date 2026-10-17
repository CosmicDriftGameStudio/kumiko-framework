import {
  type FeatureRegistrar,
  type NotificationLocalizedTemplate,
  type TemplateVariables,
  templateVariable,
} from "@cosmicdrift/kumiko-framework/engine";
import { mailHeading, mailParagraph, mailRepeatedRows } from "../../shared/index.js";
import { CONFIRMATION_LABELS } from "./confirmation-mail.js";
import { CONSENT_LOCALES, CONSENT_TEXTS, type ConsentLocale } from "./consent-text.js";
import { TERMINATION_TEXTS } from "./termination-texts.js";

// Slot syntax for the translated texts: `{name}` becomes a template variable.
const OPERATOR_EMAIL_SLOT = "{operatorEmail}";

const textRows = (): TemplateVariables[string] =>
  templateVariable.list({ text: templateVariable.text({ required: true }) }, { required: true });

export const TERMINATION_RECEIPT_VARIABLES: TemplateVariables = {
  subject: templateVariable.text({ required: true }),
  receivedAt: templateVariable.text({ required: true }),
  requestId: templateVariable.text({ required: true }),
  details: textRows(),
  operatorEmail: templateVariable.text({ required: true }),
};

export const OPERATOR_NOTICE_VARIABLES: TemplateVariables = {
  subject: templateVariable.text({ required: true }),
  lines: textRows(),
  operatorEmail: templateVariable.text({ required: true }),
};

export const CONTRACT_CONFIRMATION_VARIABLES: TemplateVariables = {
  contractLines: textRows(),
  consentGivenAt: templateVariable.text({ required: true }),
  termsParagraphs: templateVariable.list(
    { text: templateVariable.richText({ required: true }) },
    { required: true },
  ),
  operatorEmail: templateVariable.text({ required: true }),
};

function perLocale(
  build: (locale: ConsentLocale) => { body: string; subject: string },
): NotificationLocalizedTemplate {
  return Object.fromEntries(
    CONSENT_LOCALES.map((locale) => {
      const { body, subject } = build(locale);
      return [locale, { body, meta: { subject, category: "transactional" as const } }];
    }),
  );
}

export function terminationReceiptTemplate(): NotificationLocalizedTemplate {
  return perLocale((locale) => {
    const texts = TERMINATION_TEXTS[locale];
    return {
      subject: "{{subject}}",
      body: [
        mailParagraph(texts.receiptGreeting),
        mailParagraph(texts.receiptIntro),
        mailParagraph(`${texts.receivedAt}: {receivedAt}`),
        mailParagraph(`${texts.requestId}: {requestId}`),
        mailRepeatedRows("details", "text"),
        mailParagraph(texts.receiptNextSteps),
        mailParagraph(texts.receiptRevoke(OPERATOR_EMAIL_SLOT)),
        mailParagraph(`${texts.contact} {operatorEmail}`),
      ].join(""),
    };
  });
}

export function operatorNoticeTemplate(): NotificationLocalizedTemplate {
  return perLocale((locale) => ({
    subject: "{{subject}}",
    body: [
      mailParagraph(TERMINATION_TEXTS[locale].operatorIntro),
      mailRepeatedRows("lines", "text"),
      mailParagraph("{operatorEmail}"),
    ].join(""),
  }));
}

export function contractConfirmationTemplate(): NotificationLocalizedTemplate {
  return perLocale((locale) => {
    const labels = CONFIRMATION_LABELS[locale];
    const consent = CONSENT_TEXTS[locale];
    return {
      subject: labels.subject,
      body: [
        mailParagraph(labels.intro),
        mailRepeatedRows("contractLines", "text"),
        mailHeading(labels.consentHeading),
        mailParagraph(consent.earlyPerformance),
        mailParagraph(consent.withdrawalLoss),
        mailParagraph(`${labels.consentGivenAt}: {consentGivenAt}`),
        mailHeading(labels.termsHeading),
        mailRepeatedRows("termsParagraphs", "text"),
        mailParagraph(`${labels.contact} {operatorEmail}`),
      ].join(""),
    };
  });
}

// The registered notification names are the tail of the QN types in constants.ts.
export function registerConsumerProtectionMails(r: FeatureRegistrar): void {
  r.notification("contract-confirmation", {
    variables: CONTRACT_CONFIRMATION_VARIABLES,
    localizedTemplate: contractConfirmationTemplate,
  });
  r.notification("contract-termination-receipt", {
    variables: TERMINATION_RECEIPT_VARIABLES,
    localizedTemplate: terminationReceiptTemplate,
  });
  r.notification("contract-termination-operator-notice", {
    variables: OPERATOR_NOTICE_VARIABLES,
    localizedTemplate: operatorNoticeTemplate,
  });
}
