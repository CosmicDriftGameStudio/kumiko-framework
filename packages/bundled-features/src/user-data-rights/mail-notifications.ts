import {
  type FeatureRegistrar,
  QnTypes,
  qn,
  type TemplateVariables,
  templateVariable,
} from "@cosmicdrift/kumiko-framework/engine";
import { mailT } from "@cosmicdrift/kumiko-framework/i18n";
import { escapeHtml } from "@cosmicdrift/kumiko-renderer/headless";
import { mailParagraph } from "../shared/index.ts";
import { createMailLocaleTemplates } from "../shared/mail-locale-templates.ts";
import { USER_DATA_RIGHTS_FEATURE } from "./web/constants.ts";

const ALL_GDPR_MAIL_KINDS = [
  "exportReady",
  "exportFailed",
  "deletionRequested",
  "deletionExecuted",
] as const;

export type GdprMailKind = (typeof ALL_GDPR_MAIL_KINDS)[number];

export const GDPR_MAIL_KINDS: Readonly<
  Record<GdprMailKind, { readonly name: string; readonly translationKey: string }>
> = {
  exportReady: { name: "export-ready", translationKey: "exportReady" },
  exportFailed: { name: "export-failed", translationKey: "exportFailed" },
  deletionRequested: { name: "deletion-requested", translationKey: "deletionRequested" },
  deletionExecuted: { name: "deletion-executed", translationKey: "deletionExecuted" },
};

export const GdprMailNotificationTypes: Readonly<Record<GdprMailKind, string>> = {
  exportReady: gdprMailType("exportReady"),
  exportFailed: gdprMailType("exportFailed"),
  deletionRequested: gdprMailType("deletionRequested"),
  deletionExecuted: gdprMailType("deletionExecuted"),
};

function gdprMailType(kind: GdprMailKind): string {
  return qn(USER_DATA_RIGHTS_FEATURE, QnTypes.notify, GDPR_MAIL_KINDS[kind].name);
}

function subjectKey(kind: GdprMailKind): string {
  return `gdpr.mail.${GDPR_MAIL_KINDS[kind].translationKey}.subject`;
}

const mailLocaleTemplates = createMailLocaleTemplates({
  kinds: ALL_GDPR_MAIL_KINDS,
  notificationTypes: GdprMailNotificationTypes,
  subjectKey,
  bodyFor: (kind, locale) => mailBody(kind, locale),
});

export const gdprMailTemplateLocale = mailLocaleTemplates.templateLocale;

const appName = () => templateVariable.text({ required: true });

export const GDPR_MAIL_VARIABLES: Readonly<Record<GdprMailKind, TemplateVariables>> = {
  exportReady: {
    appName: appName(),
    actionUrl: templateVariable.link({ required: true }),
    validUntil: templateVariable.text({ required: true }),
  },
  exportFailed: { appName: appName() },
  deletionRequested: {
    appName: appName(),
    deletionDate: templateVariable.text({ required: true }),
  },
  deletionExecuted: { appName: appName(), executedAt: templateVariable.text({ required: true }) },
};

// Translation placeholder -> template variable per kind.
const PLACEHOLDER_SLOTS: Readonly<Record<GdprMailKind, Readonly<Record<string, string>>>> = {
  exportReady: { app: "{appName}", when: "{validUntil}" },
  exportFailed: { app: "{appName}" },
  deletionRequested: { app: "{appName}", when: "{deletionDate}" },
  deletionExecuted: { app: "{appName}", when: "{executedAt}" },
};

function paragraph(kind: GdprMailKind, locale: string, part: string): string {
  const { translationKey } = GDPR_MAIL_KINDS[kind];
  return mailParagraph(
    mailT(locale, `gdpr.mail.${translationKey}.${part}`, PLACEHOLDER_SLOTS[kind]),
  );
}

function greeting(locale: string): string {
  return mailParagraph(mailT(locale, "gdpr.mail.greeting"));
}

function mailBody(kind: GdprMailKind, locale: string): string {
  switch (kind) {
    case "exportReady":
      return [
        greeting(locale),
        paragraph(kind, locale, "intro"),
        `<p><a data-button href="{{actionUrl}}">${escapeHtml(mailT(locale, "gdpr.mail.exportReady.button"))}</a></p>`,
        paragraph(kind, locale, "expiry"),
      ].join("");
    case "exportFailed":
      return [greeting(locale), paragraph(kind, locale, "intro")].join("");
    case "deletionRequested":
      return [
        greeting(locale),
        paragraph(kind, locale, "intro"),
        paragraph(kind, locale, "cancel"),
      ].join("");
    case "deletionExecuted":
      return [greeting(locale), paragraph(kind, locale, "intro")].join("");
  }
}

export const gdprMailLocalizedTemplate = mailLocaleTemplates.localizedTemplate;

export function registerGdprMails(r: FeatureRegistrar): void {
  for (const kind of ALL_GDPR_MAIL_KINDS) {
    r.notification(GDPR_MAIL_KINDS[kind].name, {
      variables: GDPR_MAIL_VARIABLES[kind],
      localizedTemplate: gdprMailLocalizedTemplate(kind),
    });
  }
}
