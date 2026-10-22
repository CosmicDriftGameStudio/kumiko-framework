import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";

export function isTemporalInstant(v: unknown): v is Temporal.Instant {
  return propertyOf(v, Symbol.toStringTag) === "Temporal.Instant";
}

export function isTemporalPlainDate(v: unknown): v is Temporal.PlainDate {
  return propertyOf(v, Symbol.toStringTag) === "Temporal.PlainDate";
}

export function isTemporalPlainDateTimeLike(
  v: unknown,
): v is { toPlainDate(): Temporal.PlainDate } {
  const tag = propertyOf(v, Symbol.toStringTag);
  return (
    (tag === "Temporal.PlainDateTime" || tag === "Temporal.ZonedDateTime") &&
    typeof v === "object" &&
    v !== null &&
    "toPlainDate" in v &&
    typeof v.toPlainDate === "function"
  );
}
