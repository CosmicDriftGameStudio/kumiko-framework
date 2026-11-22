import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import {
  LETTER_SHIPPING_MODES,
  LETTER_STATES,
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
