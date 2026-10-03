import { Temporal } from "temporal-polyfill";
import type {
  ContractTerminationDeclarationType,
  ContractTerminationKind,
  ProviderCancelOutcome,
} from "../events.js";
import type { ConsentLocale } from "./consent-text.js";
import { type OperatorNoticeReason, TERMINATION_TEXTS } from "./termination-texts.js";

export type TerminationMailContent = {
  readonly subject: string;
  readonly header: string;
  readonly sections: readonly { readonly text: string }[];
  readonly footer: string;
};

/** What the declarant entered; the only input of the receipt. */
export type TerminationDeclaration = {
  readonly declarationType: ContractTerminationDeclarationType;
  readonly terminationKind: ContractTerminationKind;
  readonly name?: string;
  readonly email: string;
  readonly customerReference?: string;
  readonly reason?: string;
};

/** The operator notice for a provider problem has no declarant data at all. */
export type OperatorNoticeDeclaration = Pick<
  TerminationDeclaration,
  "declarationType" | "terminationKind"
> &
  Partial<Omit<TerminationDeclaration, "declarationType" | "terminationKind">>;

const TIME_ZONE_BY_LOCALE: Readonly<Record<ConsentLocale, string>> = {
  de: "Europe/Berlin",
  en: "UTC",
};

export function formatReceivedAt(iso: string, locale: ConsentLocale): string {
  let epochMilliseconds: number;
  try {
    epochMilliseconds = Temporal.Instant.from(iso).epochMilliseconds;
  } catch {
    return iso;
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "long",
    timeZone: TIME_ZONE_BY_LOCALE[locale],
  }).format(epochMilliseconds);
}

function declarationLines(
  declaration: OperatorNoticeDeclaration,
  locale: ConsentLocale,
): readonly { readonly text: string }[] {
  const texts = TERMINATION_TEXTS[locale];
  const lines = [
    `${texts.declarationType}: ${texts.declarationTypeLabel[declaration.declarationType]}`,
    `${texts.terminationKind}: ${texts.terminationKindLabel[declaration.terminationKind]}`,
    ...(declaration.name !== undefined ? [`${texts.name}: ${declaration.name}`] : []),
    ...(declaration.email !== undefined ? [`${texts.email}: ${declaration.email}`] : []),
    ...(declaration.customerReference
      ? [`${texts.customerReference}: ${declaration.customerReference}`]
      : []),
    ...(declaration.reason ? [`${texts.reasonFieldLabel}: ${declaration.reason}`] : []),
  ];
  return lines.map((text) => ({ text }));
}

export type RenderTerminationReceiptArgs = {
  readonly locale: ConsentLocale;
  readonly requestId: string;
  readonly receivedAtIso: string;
  readonly declaration: TerminationDeclaration;
  readonly operatorEmail: string;
};

/** Built from the declarant's own input only: the content must not depend on
 *  whether (or how) the declaration matched a contract. */
export function renderTerminationReceipt(
  args: RenderTerminationReceiptArgs,
): TerminationMailContent {
  const texts = TERMINATION_TEXTS[args.locale];
  const subject = texts.receiptSubject[args.declaration.declarationType];
  return {
    subject,
    header: subject,
    sections: [
      { text: texts.receiptIntro },
      { text: `${texts.receivedAt}: ${formatReceivedAt(args.receivedAtIso, args.locale)}` },
      { text: `${texts.requestId}: ${args.requestId}` },
      ...declarationLines(args.declaration, args.locale),
      { text: texts.receiptNextSteps },
      { text: texts.receiptRevoke(args.operatorEmail) },
    ],
    footer: `${texts.contact} ${args.operatorEmail}`,
  };
}

export type RenderOperatorNoticeArgs = {
  readonly locale: ConsentLocale;
  readonly requestId: string;
  readonly receivedAtIso: string;
  readonly channel: "public" | "account";
  readonly declaration: OperatorNoticeDeclaration;
  readonly reasons: readonly OperatorNoticeReason[];
  readonly tenantId?: string;
  readonly providerCancel?: ProviderCancelOutcome;
  readonly operatorEmail: string;
};

export function renderOperatorNotice(args: RenderOperatorNoticeArgs): TerminationMailContent {
  const texts = TERMINATION_TEXTS[args.locale];
  const subject = texts.operatorSubject[args.declaration.declarationType];
  return {
    subject,
    header: subject,
    sections: [
      { text: texts.operatorIntro },
      ...args.reasons.map((reason) => ({
        text: `${texts.noticeReasons}: ${texts.operatorReasons[reason]}`,
      })),
      { text: `${texts.receivedAt}: ${formatReceivedAt(args.receivedAtIso, args.locale)}` },
      { text: `${texts.requestId}: ${args.requestId}` },
      { text: `${texts.channel}: ${texts.channelLabel[args.channel]}` },
      ...(args.tenantId !== undefined ? [{ text: `${texts.tenant}: ${args.tenantId}` }] : []),
      ...(args.providerCancel !== undefined
        ? [{ text: `${texts.providerResult}: ${texts.providerResultLabel[args.providerCancel]}` }]
        : []),
      ...declarationLines(args.declaration, args.locale),
    ],
    footer: args.operatorEmail,
  };
}
