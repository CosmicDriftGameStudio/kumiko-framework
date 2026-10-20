import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type {
  ContractTerminationDeclarationType,
  ContractTerminationKind,
  ProviderCancelOutcome,
} from "../events.ts";
import type { ConsentLocale } from "./consent-text.ts";
import { type OperatorNoticeReason, TERMINATION_TEXTS } from "./termination-texts.ts";

type TextRow = { readonly text: string };

/** Variables of the termination receipt template. */
export type TerminationReceiptVariables = {
  readonly subject: string;
  readonly receivedAt: string;
  readonly requestId: string;
  readonly details: readonly TextRow[];
  readonly operatorEmail: string;
  /** Only a matched declaration carries the "this was not me" link. */
  readonly revokeUrl?: string;
};

/** Variables of the operator notice template. */
export type OperatorNoticeVariables = {
  readonly subject: string;
  readonly lines: readonly TextRow[];
  readonly operatorEmail: string;
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
): readonly TextRow[] {
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

/** The receipt carries enum fields only: free text from an anonymous caller
 *  must not be echoed to an arbitrary address. */
export type ReceiptDeclaration = Pick<
  TerminationDeclaration,
  "declarationType" | "terminationKind"
>;

export type TerminationReceiptArgs = {
  readonly locale: ConsentLocale;
  readonly requestId: string;
  readonly receivedAtIso: string;
  readonly declaration: ReceiptDeclaration;
  readonly operatorEmail: string;
  readonly revokeUrl?: string;
};

/** Apart from the revoke link, the content must not depend on whether the declaration
 *  matched a contract; the link only goes to the address the declarant entered. */
export function terminationReceiptVariables(
  args: TerminationReceiptArgs,
): TerminationReceiptVariables {
  const texts = TERMINATION_TEXTS[args.locale];
  return {
    subject: texts.receiptSubject[args.declaration.declarationType],
    receivedAt: formatReceivedAt(args.receivedAtIso, args.locale),
    requestId: args.requestId,
    details: declarationLines(args.declaration, args.locale),
    operatorEmail: args.operatorEmail,
    ...(args.revokeUrl !== undefined && { revokeUrl: args.revokeUrl }),
  };
}

export type OperatorNoticeArgs = {
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

export function operatorNoticeVariables(args: OperatorNoticeArgs): OperatorNoticeVariables {
  const texts = TERMINATION_TEXTS[args.locale];
  return {
    subject: texts.operatorSubject[args.declaration.declarationType],
    lines: [
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
    operatorEmail: args.operatorEmail,
  };
}
