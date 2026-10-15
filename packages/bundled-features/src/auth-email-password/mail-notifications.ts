import {
  type NotificationLocalizedTemplate,
  QnTypes,
  qn,
  type TemplateVariables,
  templateVariable,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  hasMailTranslationKey,
  listMailLocales,
  mailT,
  resolveMailLocale,
} from "@cosmicdrift/kumiko-framework/i18n";
import { escapeHtml, escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";
import { AUTH_EMAIL_PASSWORD_FEATURE } from "./constants.js";

export const AUTH_MAIL_KINDS = {
  passwordReset: { name: "password-reset", translationKey: "reset" },
  accountUnlock: { name: "account-unlock", translationKey: "unlock" },
  emailVerification: { name: "email-verification", translationKey: "verify" },
  signupActivation: { name: "signup-activation", translationKey: "activation" },
  invite: { name: "invite", translationKey: "invite" },
} as const;

export type AuthMailKind = keyof typeof AUTH_MAIL_KINDS;

type MagicLinkFlowOptions = Partial<
  Record<"passwordReset" | "emailVerification" | "signup" | "invite" | "accountUnlock", unknown>
>;

export function sendsMagicLinkMail(flows: MagicLinkFlowOptions): boolean {
  return Boolean(
    flows.passwordReset ||
      flows.emailVerification ||
      flows.signup ||
      flows.invite ||
      flows.accountUnlock,
  );
}

function authMailType(kind: AuthMailKind): string {
  return qn(AUTH_EMAIL_PASSWORD_FEATURE, QnTypes.notify, AUTH_MAIL_KINDS[kind].name);
}

export const AuthMailNotificationTypes: Readonly<Record<AuthMailKind, string>> = {
  passwordReset: authMailType("passwordReset"),
  accountUnlock: authMailType("accountUnlock"),
  emailVerification: authMailType("emailVerification"),
  signupActivation: authMailType("signupActivation"),
  invite: authMailType("invite"),
};

function subjectKey(kind: AuthMailKind): string {
  return `auth.mail.${AUTH_MAIL_KINDS[kind].translationKey}.subject`;
}

const ALL_AUTH_MAIL_KINDS: readonly AuthMailKind[] = [
  "passwordReset",
  "accountUnlock",
  "emailVerification",
  "signupActivation",
  "invite",
];

const SUBJECT_KEY_BY_TYPE: ReadonlyMap<string, string> = new Map(
  ALL_AUTH_MAIL_KINDS.map((kind) => [AuthMailNotificationTypes[kind], subjectKey(kind)]),
);

// A registered locale whose bundle lacks the subject key has no template (see
// authMailLocalizedTemplate); the renderer has no locale fallback, so the
// sender must pick a locale that has one or the mail would not go out at all.
export function authMailTemplateLocale(notificationType: string, requestedLocale: string): string {
  const locale = resolveMailLocale(requestedLocale);
  const key = SUBJECT_KEY_BY_TYPE.get(notificationType);
  return key !== undefined && hasMailTranslationKey(locale, key) ? locale : "en";
}

export const AUTH_MAIL_VARIABLES: TemplateVariables = {
  appName: templateVariable.text({ required: true }),
  actionUrl: templateVariable.link({ required: true }),
  validFor: templateVariable.text({ required: true }),
  validUntil: templateVariable.text({ required: true }),
};

export const INVITE_MAIL_VARIABLES: TemplateVariables = {
  ...AUTH_MAIL_VARIABLES,
  role: templateVariable.text({ required: true }),
};

// Translation placeholder -> template variable. The markers survive HTML
// escaping, so only the translated text is escaped, never the placeholders.
const PLACEHOLDER_VARIABLES: Readonly<Record<string, string>> = {
  app: "appName",
  duration: "validFor",
  when: "validUntil",
  role: "role",
};
const MARKER_OPEN = "\uE000";
const MARKER_CLOSE = "\uE001";
const MARKER_PATTERN = new RegExp(`${MARKER_OPEN}(\\w+)${MARKER_CLOSE}`, "g");

function markers(): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.keys(PLACEHOLDER_VARIABLES).map((name) => [
      name,
      `${MARKER_OPEN}${name}${MARKER_CLOSE}`,
    ]),
  );
}

function translatedHtml(locale: string, key: string): string {
  return escapeHtml(mailT(locale, key, markers())).replace(MARKER_PATTERN, (_, name: string) => {
    const variable = PLACEHOLDER_VARIABLES[name];
    return variable === undefined
      ? ""
      : `<span data-variable="${escapeHtmlAttr(variable)}"></span>`;
  });
}

function mailBody(locale: string, translationKey: string): string {
  const html = (part: string) => translatedHtml(locale, `auth.mail.${translationKey}.${part}`);
  return [
    `<p>${html("greeting")}</p>`,
    `<p>${html("intro")}</p>`,
    `<p><a data-button href="{{actionUrl}}">${html("button")}</a></p>`,
    `<p>${html("expiry")}</p>`,
    `<p>${html("ignore")}</p>`,
  ].join("");
}

// Evaluated when the registry is built, after every locale feature has
// registered its mail translations. English always ships; another locale only
// gets a template when it has its own subject, so a missing translation never
// silently becomes an English mail in that locale's slot.
export function authMailLocalizedTemplate(kind: AuthMailKind): () => NotificationLocalizedTemplate {
  const { translationKey } = AUTH_MAIL_KINDS[kind];
  const kindSubjectKey = subjectKey(kind);
  return () => {
    const locales = [
      "en",
      ...listMailLocales().filter(
        (locale) => locale !== "en" && hasMailTranslationKey(locale, kindSubjectKey),
      ),
    ];
    return Object.fromEntries(
      locales.map((locale) => [
        locale,
        {
          body: mailBody(locale, translationKey),
          meta: {
            subject: mailT(locale, kindSubjectKey, { app: "{{appName}}" }),
            category: "transactional" as const,
          },
        },
      ]),
    );
  };
}
