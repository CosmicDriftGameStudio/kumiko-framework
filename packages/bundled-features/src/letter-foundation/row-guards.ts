import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import {
  LETTER_ENVELOPES,
  LETTER_FORM_REQUIREMENTS,
  LETTER_SHIPPING_MODES,
  LETTER_STATES,
  type LetterEnvelope,
  type LetterFormRequirement,
  type LetterShippingMode,
  type LetterState,
} from "./constants.ts";

// Select columns read back as plain strings and jsonb as unknown, so rows are narrowed here once.
export function isLetterState(value: unknown): value is LetterState {
  return isOneOf(LETTER_STATES, value);
}

export function isLetterShippingMode(value: unknown): value is LetterShippingMode {
  return isOneOf(LETTER_SHIPPING_MODES, value);
}

export function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isLetterEnvelope(value: unknown): value is LetterEnvelope {
  return isOneOf(LETTER_ENVELOPES, value);
}

export function isLetterFormRequirement(value: unknown): value is LetterFormRequirement {
  return isOneOf(LETTER_FORM_REQUIREMENTS, value);
}

export function envelopeOf(letter: { readonly envelope?: unknown }): LetterEnvelope {
  return isLetterEnvelope(letter.envelope) ? letter.envelope : "folded";
}

/** True once the preparation stored the merged PDF, its page and sheet counts and the quoted price. */
export function isLetterPrepared(letter: {
  readonly mergedFileRefId?: unknown;
  readonly quotedNet?: unknown;
  readonly pageCount?: unknown;
  readonly sheetCount?: unknown;
}): boolean {
  return Boolean(
    letter.mergedFileRefId && letter.quotedNet && letter.pageCount && letter.sheetCount,
  );
}
