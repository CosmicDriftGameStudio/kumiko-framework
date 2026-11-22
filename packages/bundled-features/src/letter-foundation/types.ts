import type { MoneyRead } from "@cosmicdrift/kumiko-framework/db";
import type { egress } from "@cosmicdrift/kumiko-framework/http";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type {
  LetterCancelRefusalReason,
  LetterEnvelope,
  LetterPriceSource,
  LetterProviderState,
  LetterRejectionCode,
  LetterShippingMode,
} from "./constants.ts";

export type {
  LetterCancelRefusalReason,
  LetterEnvelope,
  LetterFormRequirement,
  LetterPriceSource,
  LetterProviderState,
  LetterRejectionCode,
  LetterShippingMode,
} from "./constants.ts";

/** Minor units of the currency, same shape as every money field. */
export type LetterMoney = MoneyRead;

export type LetterAddress = {
  readonly name: string;
  readonly addressExtra?: string | undefined;
  readonly street: string;
  readonly houseNumber: string;
  readonly postalCode: string;
  readonly city: string;
};

export type LetterProviderCapabilities = {
  readonly shippingModes: readonly LetterShippingMode[];
  readonly envelopes: readonly LetterEnvelope[];
  readonly maxSheets: number;
  readonly maxBytes: number;
  /** Sheets up to which a `flat` envelope is honored; above it the provider chooses the envelope. Unset: no limit known. */
  readonly maxFlatSheets?: number | undefined;
  /** Seconds after acceptance in which the provider still cancels; null when it never does. */
  readonly cancelWindowSeconds: number | null;
  /** Highest number of provider requests `findByReference` needs for one letter. Unset: 1. */
  readonly lookupRequestsPerLetter?: number | undefined;
};

/** Server-wide, never per tenant: the provider account belongs to the operator. */
export type LetterProviderContext = {
  /** True only when the env switch is on, which the boot allows in production alone. */
  readonly live: boolean;
  /** The booted environment; a provider validates its own variables from it (`parseEnv`). */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Binds an egress policy for the provider's host; every call to the provider goes through it. */
  readonly egress: typeof egress;
};

export type LetterSpec = {
  readonly pageCount: number;
  readonly sheetCount: number;
  readonly shippingMode: LetterShippingMode;
  readonly envelope: LetterEnvelope;
  readonly color: boolean;
  readonly duplex: boolean;
};

export type LetterQuote = {
  readonly net: LetterMoney;
  readonly priceSource: LetterPriceSource;
};

export type LetterSubmission = {
  /** The letter id, the only reference the provider gets. */
  readonly reference: string;
  readonly pdf: Uint8Array;
  readonly spec: LetterSpec;
  readonly expectedRecipient: LetterAddress;
};

export type LetterAcceptance = {
  readonly kind: "accepted";
  readonly providerJobId: string;
  readonly actualNet: LetterMoney;
  readonly actualVat: LetterMoney;
  /** The provider's whole address zone as one text, lines joined by ", ", sender line included. */
  readonly recognizedAddress?: string | undefined;
  readonly cancelableUntil?: Temporal.Instant | undefined;
  readonly trackingNumber?: string | undefined;
};

export type LetterRejection = {
  readonly kind: "rejected";
  readonly code: LetterRejectionCode;
  readonly message: string;
};

/** A timeout or an unexpected error is no result: `submit` throws it, and the letter goes to `submission-unknown`. */
export type LetterSubmitResult = LetterAcceptance | LetterRejection;

export type LetterProof = {
  readonly fileName: string;
  readonly content: Uint8Array;
};

export type LetterProviderStatus = {
  readonly state: LetterProviderState;
  readonly trackingNumber?: string | undefined;
  readonly trackingStatus?: string | undefined;
  /** Registered mail may come without proof files. */
  readonly proofs?: readonly LetterProof[] | undefined;
  /** The provider's whole address zone as one text, lines joined by ", ", sender line included. */
  readonly recognizedAddress?: string | undefined;
};

export type LetterCancelResult =
  | { readonly kind: "canceled" }
  | { readonly kind: "refused"; readonly reason: LetterCancelRefusalReason };

export type LetterProviderOrder = {
  readonly reference: string;
  readonly acceptance: LetterAcceptance;
};

export type LetterProvider = {
  quote(spec: LetterSpec): Promise<LetterQuote>;
  submit(submission: LetterSubmission): Promise<LetterSubmitResult>;
  status(providerJobId: string): Promise<LetterProviderStatus>;
  cancel?(providerJobId: string): Promise<LetterCancelResult>;
  findByReference?(reference: string): Promise<LetterSubmitResult | null>;
  /** One order by its provider id, with the reference it was placed under; null when the provider does not know it or it was canceled. */
  findByJobId?(providerJobId: string): Promise<LetterProviderOrder | null>;
};

export type LetterProviderPlugin = {
  readonly capabilities: LetterProviderCapabilities;
  readonly build: (ctx: LetterProviderContext) => Promise<LetterProvider>;
};

export function isLetterProviderPlugin(value: unknown): value is LetterProviderPlugin {
  return (
    typeof value === "object" &&
    value !== null &&
    "capabilities" in value &&
    typeof value.capabilities === "object" &&
    value.capabilities !== null &&
    "build" in value &&
    typeof value.build === "function"
  );
}
