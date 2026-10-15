import {
  type NotificationLocalizedTemplate,
  type NotificationRecordMapping,
  type TemplateVariables,
  templateVariable,
} from "@cosmicdrift/kumiko-framework/engine";
import { mailHeading, mailParagraph, mailRepeatedRows } from "../shared/index.js";

export type WaitlistMailLocale = "en" | "de" | "es";

type ConfirmationStrings = {
  readonly subject: (app: string | undefined) => string;
  readonly header: string;
  readonly intro: (app: string | undefined) => string;
  readonly footer: (app: string | undefined) => string;
};

const CONFIRMATION_STRINGS: Readonly<Record<WaitlistMailLocale, ConfirmationStrings>> = {
  en: {
    subject: (app) => (app ? `You're on the ${app} waitlist` : "You're on the waitlist"),
    header: "Waitlist confirmed",
    intro: (app) =>
      `Hi, we received your request${app ? ` for ${app}` : ""} and look at it personally. We'll email you when you can get started.`,
    footer: (app) => `If you didn't ask to join${app ? ` ${app}` : ""}, you can ignore this email.`,
  },
  de: {
    subject: (app) =>
      app ? `Du stehst auf der ${app}-Warteliste` : "Du stehst auf der Warteliste",
    header: "Warteliste bestätigt",
    intro: (app) =>
      `Hallo, wir haben deine Anfrage${app ? ` für ${app}` : ""} erhalten und schauen sie uns persönlich an. Wir melden uns per E-Mail, sobald du loslegen kannst.`,
    footer: (app) =>
      `Falls du dich nicht${app ? ` für ${app}` : ""} angemeldet hast, kannst du diese E-Mail ignorieren.`,
  },
  es: {
    subject: (app) =>
      app ? `Estás en la lista de espera de ${app}` : "Estás en la lista de espera",
    header: "Lista de espera confirmada",
    intro: (app) =>
      `Hola, hemos recibido tu solicitud${app ? ` para ${app}` : ""} y la revisamos personalmente. Te avisaremos por correo cuando puedas empezar.`,
    footer: (app) =>
      `Si no solicitaste unirte${app ? ` a ${app}` : ""}, puedes ignorar este correo.`,
  },
};

type AdminNoticeStrings = {
  readonly subject: (name: string) => string;
  readonly header: string;
  readonly intro: string;
  readonly footer: string;
};

const ADMIN_NOTICE_STRINGS: Readonly<Record<"en" | "de", AdminNoticeStrings>> = {
  en: {
    subject: (name) => `New waitlist entry: ${name}`,
    header: "New waitlist entry",
    intro: "Someone just joined the waitlist.",
    footer: "Review the entry in the admin waitlist screen.",
  },
  de: {
    subject: (name) => `Neuer Wartelisten-Eintrag: ${name}`,
    header: "Neuer Wartelisten-Eintrag",
    intro: "Jemand hat sich gerade auf die Warteliste eingetragen.",
    footer: "Den Eintrag findest du in der Wartelisten-Verwaltung.",
  },
};

function languageOf(locale: string | undefined): string {
  return (locale ?? "").split("-")[0]?.toLowerCase() ?? "";
}

function isConfirmationLocale(language: string): language is WaitlistMailLocale {
  return language === "en" || language === "de" || language === "es";
}

export function resolveWaitlistMailLocale(locale: string | undefined): WaitlistMailLocale {
  const language = languageOf(locale);
  return isConfirmationLocale(language) ? language : "en";
}

export const WAITLIST_CONFIRMATION_VARIABLES: TemplateVariables = {
  subject: templateVariable.text({ required: true }),
  intro: templateVariable.text({ required: true }),
  footer: templateVariable.text({ required: true }),
};

// Only `name` is a plain entry field; the details rows are composed from several fields.
export const WAITLIST_ADMIN_NOTICE_RECORD: NotificationRecordMapping = {
  entity: "waitlistEntry",
  map: { name: "name" },
};

export const WAITLIST_ADMIN_NOTICE_VARIABLES: TemplateVariables = {
  name: templateVariable.text({ required: true }),
  details: templateVariable.list(
    { text: templateVariable.text({ required: true }) },
    { required: true },
  ),
};

// The app name is optional, so the sentences that mention it are computed in
// code and handed over as variables; the template keeps heading and structure.
// The submitter's name stays out: the address is unverified, so any text in
// this mail could be planted by whoever typed someone else's email.
export function waitlistConfirmationVariables(args: {
  readonly locale: string | undefined;
  readonly appName?: string | undefined;
}): { readonly subject: string; readonly intro: string; readonly footer: string } {
  const t = CONFIRMATION_STRINGS[resolveWaitlistMailLocale(args.locale)];
  return {
    subject: t.subject(args.appName),
    intro: t.intro(args.appName),
    footer: t.footer(args.appName),
  };
}

export function waitlistConfirmationTemplate(): NotificationLocalizedTemplate {
  return Object.fromEntries(
    Object.entries(CONFIRMATION_STRINGS).map(([locale, t]) => [
      locale,
      {
        body: [mailHeading(t.header), mailParagraph("{intro}"), mailParagraph("{footer}")].join(""),
        meta: { subject: "{{subject}}", category: "transactional" as const },
      },
    ]),
  );
}

// Operator-facing, so the entrant's locale does not apply: en/de, en default.
export function resolveWaitlistAdminMailLocale(adminLocale: string | undefined): "en" | "de" {
  return languageOf(adminLocale) === "de" ? "de" : "en";
}

export function waitlistAdminNoticeVariables(args: {
  readonly name: string;
  readonly email: string;
  readonly company: string | undefined;
  readonly message: string | undefined;
}): { readonly name: string; readonly details: readonly { readonly text: string }[] } {
  return {
    name: args.name,
    details: [
      `${args.name} <${args.email}>`,
      ...(args.company ? [args.company] : []),
      ...(args.message ? [args.message] : []),
    ].map((text) => ({ text })),
  };
}

export function waitlistAdminNoticeTemplate(): NotificationLocalizedTemplate {
  return Object.fromEntries(
    Object.entries(ADMIN_NOTICE_STRINGS).map(([locale, t]) => [
      locale,
      {
        body: [
          mailHeading(t.header),
          mailParagraph(t.intro),
          mailRepeatedRows("details", "text"),
          mailParagraph(t.footer),
        ].join(""),
        meta: { subject: t.subject("{{name}}"), category: "transactional" as const },
      },
    ]),
  );
}
