import type { ContractTerminationDeclarationType, ContractTerminationKind } from "../events.js";
import type { ConsentLocale } from "./consent-text.js";

// Legal wording shown to the consumer, deliberately inline de/en like the
// consent texts (not the en-only i18n convention).
export type TerminationTexts = {
  readonly declarationTypeLabel: Readonly<Record<ContractTerminationDeclarationType, string>>;
  readonly terminationKindLabel: Readonly<Record<ContractTerminationKind, string>>;
  readonly declarationType: string;
  readonly terminationKind: string;
  readonly receivedAt: string;
  readonly requestId: string;
  readonly name: string;
  readonly email: string;
  readonly customerReference: string;
  readonly reasonFieldLabel: string;
  readonly receiptSubject: Readonly<Record<ContractTerminationDeclarationType, string>>;
  readonly receiptIntro: string;
  readonly receiptNextSteps: string;
  readonly receiptRevoke: (operatorEmail: string) => string;
  readonly contact: string;
  readonly operatorSubject: Readonly<Record<ContractTerminationDeclarationType, string>>;
  readonly operatorIntro: string;
  readonly operatorReasons: Readonly<Record<OperatorNoticeReason, string>>;
  readonly noticeReasons: string;
  readonly channel: string;
  readonly channelLabel: Readonly<Record<"public" | "account", string>>;
  readonly tenant: string;
  readonly providerResult: string;
  readonly providerResultLabel: Readonly<Record<"period-end" | "immediately" | "none", string>>;
  readonly page: PageTexts;
};

export type PageTexts = {
  readonly title: string;
  readonly lead: string;
  readonly declarationTypeHeading: string;
  readonly kindHeading: string;
  readonly reasonHint: string;
  readonly earliestDate: string;
  readonly nameLabel: string;
  readonly emailLabel: string;
  readonly customerReferenceLabel: string;
  readonly reasonLabel: string;
  readonly reviewButton: string;
  readonly reviewTitle: string;
  readonly reviewLead: string;
  readonly confirmButton: Readonly<Record<ContractTerminationDeclarationType, string>>;
  readonly backButton: string;
  readonly resultTitle: string;
  readonly resultLead: string;
  readonly resultReceivedAt: string;
  readonly resultRequestId: string;
  readonly resultMailNote: string;
  readonly errorsHeading: string;
  readonly errorName: string;
  readonly errorEmail: string;
  readonly errorReason: string;
  readonly errorChoice: string;
  readonly errorGeneric: string;
  readonly rateLimitedTitle: string;
  readonly rateLimitedBody: string;
};

export const OPERATOR_NOTICE_REASONS = [
  "unmatched",
  "ambiguous",
  "withdrawal",
  "extraordinary",
  "provider_cannot_cancel",
  "provider_error",
  "no_active_subscription",
  "recording_failed",
] as const;
export type OperatorNoticeReason = (typeof OPERATOR_NOTICE_REASONS)[number];

export const TERMINATION_TEXTS: Readonly<Record<ConsentLocale, TerminationTexts>> = {
  de: {
    declarationTypeLabel: { termination: "Kündigung", withdrawal: "Widerruf" },
    terminationKindLabel: {
      ordinary: "Ordentlich zum nächstmöglichen Zeitpunkt",
      extraordinary: "Außerordentlich (aus wichtigem Grund)",
    },
    declarationType: "Erklärung",
    terminationKind: "Art der Kündigung",
    receivedAt: "Eingegangen am",
    requestId: "Vorgangsnummer",
    name: "Name",
    email: "E-Mail",
    customerReference: "Kundennummer / Referenz",
    reasonFieldLabel: "Begründung",
    receiptSubject: {
      termination: "Eingangsbestätigung Ihrer Kündigung",
      withdrawal: "Eingangsbestätigung Ihres Widerrufs",
    },
    receiptIntro:
      "wir bestätigen den Eingang Ihrer Erklärung mit folgendem Inhalt. Diese E-Mail ist eine Eingangsbestätigung, keine Bestätigung der Wirksamkeit.",
    receiptNextSteps:
      "Wir prüfen Ihre Erklärung und melden uns, sobald sie bearbeitet ist oder wir Rückfragen haben.",
    receiptRevoke: (operatorEmail) =>
      `Haben Sie diese Erklärung nicht abgegeben oder möchten Sie sie zurücknehmen? Schreiben Sie uns bitte umgehend an ${operatorEmail}.`,
    contact: "Fragen richten Sie bitte an",
    operatorSubject: {
      termination: "Kündigung: Bearbeitung nötig",
      withdrawal: "Widerruf: Bearbeitung nötig",
    },
    operatorIntro: "Es ist eine Erklärung eingegangen, die Ihre Bearbeitung braucht.",
    operatorReasons: {
      unmatched: "Kein passender Vertrag zur angegebenen E-Mail gefunden",
      ambiguous: "Die angegebene E-Mail passt zu mehreren Verträgen",
      withdrawal: "Widerruf (nur Erfassung, kein Anbieter-Aufruf über das öffentliche Formular)",
      extraordinary: "Außerordentliche Kündigung, Begründung prüfen",
      provider_cannot_cancel: "Der Zahlungsanbieter unterstützt keine Kündigung per Schnittstelle",
      provider_error: "Die Kündigung beim Zahlungsanbieter ist fehlgeschlagen",
      no_active_subscription: "Keine laufende Subscription beim Anbieter",
      recording_failed: "Die Erklärung konnte nicht gespeichert werden",
    },
    noticeReasons: "Grund der Benachrichtigung",
    channel: "Kanal",
    channelLabel: { public: "Öffentliches Formular", account: "Kundenkonto" },
    tenant: "Mandant",
    providerResult: "Kündigung beim Anbieter",
    providerResultLabel: {
      "period-end": "zum Ende des Abrechnungszeitraums veranlasst",
      immediately: "sofort veranlasst",
      none: "nicht veranlasst",
    },
    page: {
      title: "Vertrag kündigen oder widerrufen",
      lead: "Mit diesem Formular erklären Sie die Kündigung oder den Widerruf Ihres Vertrags. Sie brauchen dafür kein Kundenkonto.",
      declarationTypeHeading: "Was möchten Sie erklären?",
      kindHeading: "Art der Kündigung",
      reasonHint: "Pflicht bei außerordentlicher Kündigung.",
      earliestDate: "Die Kündigung gilt zum nächstmöglichen Zeitpunkt.",
      nameLabel: "Name",
      emailLabel: "E-Mail-Adresse des Kontos",
      customerReferenceLabel: "Kundennummer (optional)",
      reasonLabel: "Begründung",
      reviewButton: "Weiter zur Prüfung",
      reviewTitle: "Bitte prüfen Sie Ihre Angaben",
      reviewLead: "Erst mit dem Klick auf den Button unten wird Ihre Erklärung abgegeben.",
      confirmButton: { termination: "Jetzt kündigen", withdrawal: "Jetzt widerrufen" },
      backButton: "Angaben ändern",
      resultTitle: "Ihre Erklärung ist eingegangen",
      resultLead: "Wir haben Ihre Erklärung erhalten und senden Ihnen eine Eingangsbestätigung.",
      resultReceivedAt: "Eingegangen am",
      resultRequestId: "Vorgangsnummer",
      resultMailNote: "Die Eingangsbestätigung geht an die von Ihnen angegebene E-Mail-Adresse.",
      errorsHeading: "Bitte korrigieren Sie Ihre Angaben",
      errorName: "Bitte geben Sie Ihren Namen an.",
      errorEmail: "Bitte geben Sie eine gültige E-Mail-Adresse an.",
      errorReason: "Bei einer außerordentlichen Kündigung ist eine Begründung nötig.",
      errorChoice: "Bitte wählen Sie eine Erklärung und die Art der Kündigung.",
      errorGeneric:
        "Ihre Erklärung konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.",
      rateLimitedTitle: "Zu viele Anfragen",
      rateLimitedBody:
        "Von Ihrer Adresse kamen zu viele Anfragen. Bitte versuchen Sie es später erneut.",
    },
  },
  en: {
    declarationTypeLabel: { termination: "Termination", withdrawal: "Withdrawal" },
    terminationKindLabel: {
      ordinary: "Ordinary, at the earliest possible date",
      extraordinary: "Extraordinary (for good cause)",
    },
    declarationType: "Declaration",
    terminationKind: "Kind of termination",
    receivedAt: "Received on",
    requestId: "Reference number",
    name: "Name",
    email: "Email",
    customerReference: "Customer number / reference",
    reasonFieldLabel: "Reason",
    receiptSubject: {
      termination: "Receipt for your termination",
      withdrawal: "Receipt for your withdrawal",
    },
    receiptIntro:
      "we confirm receipt of your declaration with the following content. This email is a receipt, not a confirmation that the declaration is effective.",
    receiptNextSteps:
      "We will review your declaration and get back to you once it is processed or if we have questions.",
    receiptRevoke: (operatorEmail) =>
      `If you did not make this declaration or want to take it back, please write to ${operatorEmail} right away.`,
    contact: "Questions go to",
    operatorSubject: {
      termination: "Termination: action needed",
      withdrawal: "Withdrawal: action needed",
    },
    operatorIntro: "A declaration arrived that needs your attention.",
    operatorReasons: {
      unmatched: "No contract matches the entered email",
      ambiguous: "The entered email matches several contracts",
      withdrawal: "Withdrawal (recorded only, no provider call from the public form)",
      extraordinary: "Extraordinary termination, review the reason",
      provider_cannot_cancel: "The payment provider does not support cancelling through its API",
      provider_error: "Cancelling at the payment provider failed",
      no_active_subscription: "No running subscription at the provider",
      recording_failed: "The declaration could not be stored",
    },
    noticeReasons: "Reason for this notice",
    channel: "Channel",
    channelLabel: { public: "Public form", account: "Customer account" },
    tenant: "Tenant",
    providerResult: "Cancellation at the provider",
    providerResultLabel: {
      "period-end": "requested for the end of the billing period",
      immediately: "requested immediately",
      none: "not requested",
    },
    page: {
      title: "Terminate or withdraw from your contract",
      lead: "Use this form to terminate your contract or withdraw from it. You do not need a customer account.",
      declarationTypeHeading: "What do you want to declare?",
      kindHeading: "Kind of termination",
      reasonHint: "Required for an extraordinary termination.",
      earliestDate: "The termination takes effect at the earliest possible date.",
      nameLabel: "Name",
      emailLabel: "Email address of the account",
      customerReferenceLabel: "Customer number (optional)",
      reasonLabel: "Reason",
      reviewButton: "Continue to review",
      reviewTitle: "Please check your details",
      reviewLead: "Your declaration is only submitted when you click the button below.",
      confirmButton: { termination: "Cancel now", withdrawal: "Withdraw now" },
      backButton: "Change details",
      resultTitle: "Your declaration was received",
      resultLead: "We received your declaration and are sending you a receipt.",
      resultReceivedAt: "Received on",
      resultRequestId: "Reference number",
      resultMailNote: "The receipt goes to the email address you entered.",
      errorsHeading: "Please correct your details",
      errorName: "Please enter your name.",
      errorEmail: "Please enter a valid email address.",
      errorReason: "An extraordinary termination needs a reason.",
      errorChoice: "Please choose a declaration and the kind of termination.",
      errorGeneric: "Your declaration could not be processed. Please try again.",
      rateLimitedTitle: "Too many requests",
      rateLimitedBody: "Too many requests came from your address. Please try again later.",
    },
  },
};
