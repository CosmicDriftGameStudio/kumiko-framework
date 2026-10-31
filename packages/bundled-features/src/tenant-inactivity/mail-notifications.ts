import {
  type FeatureRegistrar,
  QnTypes,
  qn,
  type TemplateVariables,
  templateVariable,
} from "@cosmicdrift/kumiko-framework/engine";
import { mailT } from "@cosmicdrift/kumiko-framework/i18n";
import { escapeHtml } from "@cosmicdrift/kumiko-renderer/headless";
import { createMailLocaleTemplates, mailParagraph } from "../shared/index.ts";
import { TENANT_INACTIVITY_FEATURE } from "./constants.ts";

const WARNING_MAIL_NAME = "warning";

export const InactivityWarningNotificationType = qn(
  TENANT_INACTIVITY_FEATURE,
  QnTypes.notify,
  WARNING_MAIL_NAME,
);

const WARNING_SUBJECT_KEY = "inactivity.mail.warning.subject";

// Translation placeholder -> template variable.
// The translation slot is named account because locale-de rejects the word tenant in values.
const SLOTS = { app: "{app}", account: "{tenant}", when: "{when}" } as const;
const SUBJECT_SLOTS = { app: "{{app}}", account: "{{tenant}}", when: "{{when}}" } as const;

const WARNING_VARIABLES: TemplateVariables = {
  app: templateVariable.text({ required: true }),
  tenant: templateVariable.text({ required: true }),
  when: templateVariable.text({ required: true }),
  keepUrl: templateVariable.link({ required: true }),
};

function warningBody(locale: string): string {
  const paragraph = (part: string) =>
    mailParagraph(mailT(locale, `inactivity.mail.warning.${part}`, SLOTS));
  return [
    mailParagraph(mailT(locale, "gdpr.mail.greeting")),
    paragraph("intro"),
    paragraph("keep"),
    `<p><a data-button href="{{keepUrl}}">${escapeHtml(mailT(locale, "inactivity.mail.warning.button"))}</a></p>`,
    paragraph("after"),
  ].join("");
}

const mailLocaleTemplates = createMailLocaleTemplates({
  kinds: [WARNING_MAIL_NAME],
  notificationTypes: { [WARNING_MAIL_NAME]: InactivityWarningNotificationType },
  subjectKey: () => WARNING_SUBJECT_KEY,
  bodyFor: (_kind, locale) => warningBody(locale),
  subjectSlots: () => SUBJECT_SLOTS,
});

export const inactivityMailTemplateLocale = mailLocaleTemplates.templateLocale;

export function registerInactivityMails(r: FeatureRegistrar): void {
  r.notification(WARNING_MAIL_NAME, {
    variables: WARNING_VARIABLES,
    localizedTemplate: mailLocaleTemplates.localizedTemplate(WARNING_MAIL_NAME),
  });
}
