import {
  type NotificationLocalizedTemplate,
  type TemplateVariables,
  templateVariable,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  mailHeading,
  mailParagraph,
  mailParagraphWithLink,
  mailRepeatedRows,
} from "../shared/index.ts";
import { CONTACT_KIND, type ContactKind } from "./web/constants.ts";

export type ContactMailLocale = "en" | "de";

const QUOTE_MAX_CHARS = 280;

function languageOf(locale: string | undefined): string {
  return (locale ?? "").split("-")[0]?.toLowerCase() ?? "";
}

export function resolveContactMailLocale(locale: string | undefined): ContactMailLocale {
  return languageOf(locale) === "de" ? "de" : "en";
}

export function truncateText(text: string, maxChars: number): string {
  const chars = [...text];
  return chars.length <= maxChars
    ? text
    : `${chars
        .slice(0, maxChars - 1)
        .join("")
        .trimEnd()}…`;
}

const KIND_LABELS: Readonly<Record<ContactMailLocale, Readonly<Record<ContactKind, string>>>> = {
  en: {
    [CONTACT_KIND.Question]: "Question",
    [CONTACT_KIND.Contact]: "Contact request",
    [CONTACT_KIND.Bug]: "Problem",
    [CONTACT_KIND.Wish]: "Wish",
  },
  de: {
    [CONTACT_KIND.Question]: "Frage",
    [CONTACT_KIND.Contact]: "Kontaktwunsch",
    [CONTACT_KIND.Bug]: "Problem",
    [CONTACT_KIND.Wish]: "Wunsch",
  },
};

export function contactKindLabel(kind: string, locale: string | undefined): string {
  const labels: Readonly<Record<string, string>> = KIND_LABELS[resolveContactMailLocale(locale)];
  return labels[kind] ?? kind;
}

export function formatContactDate(atEpochMs: number, locale: string | undefined): string {
  return new Intl.DateTimeFormat(resolveContactMailLocale(locale), {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(atEpochMs);
}

function toParagraphRows(message: string): readonly { readonly text: string }[] {
  return message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((text) => ({ text }));
}

// The notification names only the kind, the app and the inbox link: requests carry personal
// data, and mail, in-app and Telegram are not places that can be shredded or recalled.
type NewRequestStrings = {
  readonly header: string;
  readonly linkIntro: string;
  readonly linkLabel: string;
  readonly title: Readonly<Record<ContactKind, (appName: string) => string>>;
};

const NEW_REQUEST_STRINGS: Readonly<Record<ContactMailLocale, NewRequestStrings>> = {
  en: {
    header: "New request",
    linkIntro: "Open it in the admin:",
    linkLabel: "Show request",
    title: {
      [CONTACT_KIND.Question]: (app) => `New question on ${app}`,
      [CONTACT_KIND.Contact]: (app) => `New contact request on ${app}`,
      [CONTACT_KIND.Bug]: (app) => `New problem report on ${app}`,
      [CONTACT_KIND.Wish]: (app) => `New wish on ${app}`,
    },
  },
  de: {
    header: "Neue Meldung",
    linkIntro: "Im Admin öffnen:",
    linkLabel: "Meldung anzeigen",
    title: {
      [CONTACT_KIND.Question]: (app) => `Neue Frage auf ${app}`,
      [CONTACT_KIND.Contact]: (app) => `Neuer Kontaktwunsch auf ${app}`,
      [CONTACT_KIND.Bug]: (app) => `Neue Problemmeldung auf ${app}`,
      [CONTACT_KIND.Wish]: (app) => `Neuer Wunsch auf ${app}`,
    },
  },
};

export const CONTACT_NEW_REQUEST_VARIABLES: TemplateVariables = {
  subject: templateVariable.text({ required: true }),
  intro: templateVariable.text({ required: true }),
  requestUrl: templateVariable.link(),
};

export type NewRequestMailArgs = {
  readonly kind: string;
  readonly appName: string;
  readonly link: string | undefined;
  readonly locale: string | undefined;
};

export function contactNewRequestVariables(args: NewRequestMailArgs) {
  const titles: Readonly<Record<string, (appName: string) => string>> =
    NEW_REQUEST_STRINGS[resolveContactMailLocale(args.locale)].title;
  const title =
    (titles[args.kind] ?? titles[CONTACT_KIND.Question])?.(args.appName) ?? args.appName;
  return {
    subject: title,
    intro: title,
    ...(args.link !== undefined && { requestUrl: args.link }),
    inAppTitle: title,
    inAppBody: args.appName,
    telegramTitle: title,
    telegramBody: args.link ?? args.appName,
  };
}

export function contactNewRequestTemplate(): NotificationLocalizedTemplate {
  return Object.fromEntries(
    Object.entries(NEW_REQUEST_STRINGS).map(([locale, t]) => [
      locale,
      {
        body: [
          mailHeading(t.header),
          mailParagraph("{intro}"),
          mailParagraphWithLink(t.linkIntro, t.linkLabel, "requestUrl", { showIf: "requestUrl" }),
        ].join(""),
        meta: { subject: "{{subject}}", category: "transactional" as const },
      },
    ]),
  );
}

type ConfirmationStrings = {
  readonly subject: string;
  readonly header: string;
  readonly intro: (appName: string) => string;
  readonly quoteIntro: string;
};

const CONFIRMATION_STRINGS: Readonly<Record<ContactMailLocale, ConfirmationStrings>> = {
  en: {
    subject: "Your message to {{appName}}",
    header: "Thanks for your message",
    intro: (appName) =>
      `We received your message to the ${appName} team and will get back to you personally. Here is a copy:`,
    quoteIntro: "Your message:",
  },
  de: {
    subject: "Deine Nachricht an {{appName}}",
    header: "Danke für deine Nachricht",
    intro: (appName) =>
      `Deine Nachricht ist beim ${appName}-Team angekommen, wir melden uns persönlich bei dir. Hier ist eine Kopie:`,
    quoteIntro: "Deine Nachricht:",
  },
};

type AcknowledgementStrings = {
  readonly subject: string;
  readonly header: string;
  readonly intro: (appName: string) => string;
};

const ACKNOWLEDGEMENT_STRINGS: Readonly<Record<ContactMailLocale, AcknowledgementStrings>> = {
  en: {
    subject: "Your message to {{appName}}",
    header: "Thanks for your message",
    intro: (appName) =>
      `We received your message to the ${appName} team and will get back to you personally.`,
  },
  de: {
    subject: "Deine Nachricht an {{appName}}",
    header: "Danke für deine Nachricht",
    intro: (appName) =>
      `Deine Nachricht ist beim ${appName}-Team angekommen, wir melden uns persönlich bei dir.`,
  },
};

export const CONTACT_CONFIRMATION_VARIABLES: TemplateVariables = {
  appName: templateVariable.text({ required: true }),
  intro: templateVariable.text({ required: true }),
  quoteIntro: templateVariable.text({ required: true }),
  paragraphs: templateVariable.list(
    { text: templateVariable.text({ required: true }) },
    { required: true },
  ),
};

export function contactConfirmationVariables(args: {
  readonly appName: string;
  readonly message: string;
  readonly locale: string | undefined;
}) {
  const t = CONFIRMATION_STRINGS[resolveContactMailLocale(args.locale)];
  return {
    appName: args.appName,
    intro: t.intro(args.appName),
    quoteIntro: t.quoteIntro,
    paragraphs: toParagraphRows(args.message),
  };
}

// Website senders are unverified addresses: the mail must not echo anything they typed, or the
// form becomes a mail relay. Only the signed-in admin report gets the copy above.
export const CONTACT_ACKNOWLEDGEMENT_VARIABLES: TemplateVariables = {
  appName: templateVariable.text({ required: true }),
  intro: templateVariable.text({ required: true }),
};

export function contactAcknowledgementVariables(args: {
  readonly appName: string;
  readonly locale: string | undefined;
}) {
  const t = ACKNOWLEDGEMENT_STRINGS[resolveContactMailLocale(args.locale)];
  return { appName: args.appName, intro: t.intro(args.appName) };
}

export function contactAcknowledgementTemplate(): NotificationLocalizedTemplate {
  return Object.fromEntries(
    Object.entries(ACKNOWLEDGEMENT_STRINGS).map(([locale, t]) => [
      locale,
      {
        body: [mailHeading(t.header), mailParagraph("{intro}")].join(""),
        meta: { subject: t.subject, category: "transactional" as const },
      },
    ]),
  );
}

export function contactConfirmationTemplate(): NotificationLocalizedTemplate {
  return Object.fromEntries(
    Object.entries(CONFIRMATION_STRINGS).map(([locale, t]) => [
      locale,
      {
        body: [
          mailHeading(t.header),
          mailParagraph("{intro}"),
          mailParagraph("{quoteIntro}"),
          mailRepeatedRows("paragraphs", "text"),
        ].join(""),
        meta: { subject: t.subject, category: "transactional" as const },
      },
    ]),
  );
}

type ReplyStrings = { readonly footer: string; readonly quoteIntro: (date: string) => string };

const REPLY_STRINGS: Readonly<Record<ContactMailLocale, ReplyStrings>> = {
  en: {
    footer: "You can reply directly to this email.",
    quoteIntro: (date) => `Your request from ${date}:`,
  },
  de: {
    footer: "Du kannst direkt auf diese Mail antworten.",
    quoteIntro: (date) => `Deine Meldung vom ${date}:`,
  },
};

export const CONTACT_REPLY_VARIABLES: TemplateVariables = {
  subject: templateVariable.text({ required: true }),
  paragraphs: templateVariable.list(
    { text: templateVariable.text({ required: true }) },
    { required: true },
  ),
  signedBy: templateVariable.text({ required: true }),
  quoteIntro: templateVariable.text({ required: true }),
  quote: templateVariable.text({ required: true }),
  footer: templateVariable.text({ required: true }),
};

export function contactReplyVariables(args: {
  readonly requestSubject: string;
  readonly requestMessage: string;
  readonly requestSubmittedAt: number;
  readonly replyMessage: string;
  readonly authorName: string;
  readonly appName: string;
  readonly locale: string | undefined;
}) {
  const t = REPLY_STRINGS[resolveContactMailLocale(args.locale)];
  return {
    subject: `Re: ${args.requestSubject}`,
    paragraphs: toParagraphRows(args.replyMessage),
    signedBy: `${args.authorName}, ${args.appName}`,
    quoteIntro: t.quoteIntro(formatContactDate(args.requestSubmittedAt, args.locale)),
    quote: truncateText(args.requestMessage.replace(/\s+/g, " "), QUOTE_MAX_CHARS),
    footer: t.footer,
  };
}

export function contactReplyTemplate(): NotificationLocalizedTemplate {
  return Object.fromEntries(
    Object.keys(REPLY_STRINGS).map((locale) => [
      locale,
      {
        body: [
          mailRepeatedRows("paragraphs", "text"),
          mailParagraph("{signedBy}"),
          mailParagraph("{quoteIntro}"),
          mailParagraph("{quote}"),
          mailParagraph("{footer}"),
        ].join(""),
        meta: { subject: "{{subject}}", category: "transactional" as const },
      },
    ]),
  );
}

type TestStrings = { readonly subject: string; readonly header: string; readonly intro: string };

const TEST_STRINGS: Readonly<Record<ContactMailLocale, TestStrings>> = {
  en: {
    subject: "Test message from {{appName}}",
    header: "Test message",
    intro: "This is a test message of the contact forwarding.",
  },
  de: {
    subject: "Testnachricht von {{appName}}",
    header: "Testnachricht",
    intro: "Das ist eine Testnachricht der Weiterleitung von Meldungen.",
  },
};

export const CONTACT_TEST_VARIABLES: TemplateVariables = {
  appName: templateVariable.text({ required: true }),
};

export function contactTestVariables(args: {
  readonly appName: string;
  readonly locale: string | undefined;
}) {
  const t = TEST_STRINGS[resolveContactMailLocale(args.locale)];
  return {
    appName: args.appName,
    telegramTitle: t.subject.replace("{{appName}}", args.appName),
    telegramBody: t.intro,
  };
}

export function contactTestTemplate(): NotificationLocalizedTemplate {
  return Object.fromEntries(
    Object.entries(TEST_STRINGS).map(([locale, t]) => [
      locale,
      {
        body: [mailHeading(t.header), mailParagraph(t.intro)].join(""),
        meta: { subject: t.subject, category: "transactional" as const },
      },
    ]),
  );
}

const REPLY_IN_APP_STRINGS: Readonly<
  Record<ContactMailLocale, (authorName: string) => { title: string; body: string }>
> = {
  en: (authorName) => ({
    title: "Answer to your request",
    body: `${authorName} replied. The answer is in your inbox.`,
  }),
  de: (authorName) => ({
    title: "Antwort auf deine Meldung",
    body: `${authorName} hat geantwortet. Die Antwort liegt in deinem Postfach.`,
  }),
};

export function contactReplyInAppData(args: {
  readonly authorName: string;
  readonly locale: string | undefined;
}): { readonly inAppTitle: string; readonly inAppBody: string } {
  const copy = REPLY_IN_APP_STRINGS[resolveContactMailLocale(args.locale)](args.authorName);
  return { inAppTitle: copy.title, inAppBody: copy.body };
}

function stringField(data: Readonly<Record<string, unknown>>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

export function telegramTemplate(data: Readonly<Record<string, unknown>>) {
  return { title: stringField(data, "telegramTitle"), body: stringField(data, "telegramBody") };
}

export function inAppTemplate(data: Readonly<Record<string, unknown>>) {
  return { title: stringField(data, "inAppTitle"), body: stringField(data, "inAppBody") };
}
