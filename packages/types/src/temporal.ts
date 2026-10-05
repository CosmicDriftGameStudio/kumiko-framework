/// <reference types="temporal-polyfill/global" preserve="true" />
import { Temporal as TemporalPolyfill } from "temporal-polyfill";

// Single source of the Temporal API: Bun >= 1.4, Node and current browsers ship
// a native `globalThis.Temporal`; Hermes/Safari/Metro do not. Everything that
// creates or checks Temporal values must resolve to the SAME classes, or
// `z.instanceof(Temporal.Instant)` in consumer code rejects framework-made
// instants ("expected Instant, received Instant"). Hence: native wins, the
// polyfill is only used (and then installed on globalThis) when it is missing.
// Only globalThis access here — no Node API — so Metro/React Native can bundle it.
//
// Typed as the AMBIENT global: every `Temporal.Instant` annotation in the repo
// (and in consumers) resolves against it, while the polyfill package ships its
// own nominally distinct copy of the same declarations (TS 7 also has a lib
// version). Casting once here keeps call sites cast-free.

export type TemporalApi = typeof globalThis.Temporal;

function resolveTemporal(): TemporalApi {
  // System boundary: same TC39 API, only the typings differ.
  const native = (globalThis as unknown as { Temporal?: TemporalApi }).Temporal;
  if (native !== undefined) return native;
  const polyfill = TemporalPolyfill as unknown as TemporalApi;
  Object.assign(globalThis, { Temporal: polyfill });
  return polyfill;
}

export const Temporal: TemporalApi = resolveTemporal();

// Type-only members mirrored from the ambient namespace so `Temporal.Instant`
// etc. keep working as types next to the value export above.
export declare namespace Temporal {
  type ComparisonResult = globalThis.Temporal.ComparisonResult;
  type RoundingMode = globalThis.Temporal.RoundingMode;
  type AssignmentOptions = globalThis.Temporal.AssignmentOptions;
  type DurationOptions = globalThis.Temporal.DurationOptions;
  type ToInstantOptions = globalThis.Temporal.ToInstantOptions;
  type OffsetDisambiguationOptions = globalThis.Temporal.OffsetDisambiguationOptions;
  type ZonedDateTimeAssignmentOptions = globalThis.Temporal.ZonedDateTimeAssignmentOptions;
  type ArithmeticOptions = globalThis.Temporal.ArithmeticOptions;
  type DateUnit = globalThis.Temporal.DateUnit;
  type TimeUnit = globalThis.Temporal.TimeUnit;
  type DateTimeUnit = globalThis.Temporal.DateTimeUnit;
  type ToStringPrecisionOptions = globalThis.Temporal.ToStringPrecisionOptions;
  type ShowCalendarOption = globalThis.Temporal.ShowCalendarOption;
  type CalendarTypeToStringOptions = globalThis.Temporal.CalendarTypeToStringOptions;
  type ZonedDateTimeToStringOptions = globalThis.Temporal.ZonedDateTimeToStringOptions;
  type InstantToStringOptions = globalThis.Temporal.InstantToStringOptions;
  type TransitionDirection = globalThis.Temporal.TransitionDirection;
  type DurationLike = globalThis.Temporal.DurationLike;
  type DurationFormatOptions = globalThis.Temporal.DurationFormatOptions;
  type Duration = globalThis.Temporal.Duration;
  type Instant = globalThis.Temporal.Instant;
  type CalendarLike = globalThis.Temporal.CalendarLike;
  type PlainDateLike = globalThis.Temporal.PlainDateLike;
  type PlainDate = globalThis.Temporal.PlainDate;
  type PlainDateTimeLike = globalThis.Temporal.PlainDateTimeLike;
  type PlainDateTime = globalThis.Temporal.PlainDateTime;
  type PlainMonthDayLike = globalThis.Temporal.PlainMonthDayLike;
  type PlainMonthDay = globalThis.Temporal.PlainMonthDay;
  type PlainTimeLike = globalThis.Temporal.PlainTimeLike;
  type PlainTime = globalThis.Temporal.PlainTime;
  type TimeZoneLike = globalThis.Temporal.TimeZoneLike;
  type PlainYearMonthLike = globalThis.Temporal.PlainYearMonthLike;
  type PlainYearMonth = globalThis.Temporal.PlainYearMonth;
  type ZonedDateTimeLike = globalThis.Temporal.ZonedDateTimeLike;
  type ZonedDateTime = globalThis.Temporal.ZonedDateTime;
  type DurationArithmeticOptions = globalThis.Temporal.DurationArithmeticOptions;
  type DurationRoundTo = globalThis.Temporal.DurationRoundTo;
  type DurationTotalOf = globalThis.Temporal.DurationTotalOf;
  type PluralUnit<T extends globalThis.Temporal.DateTimeUnit> = globalThis.Temporal.PluralUnit<T>;
  type LargestUnit<T extends globalThis.Temporal.DateTimeUnit> = globalThis.Temporal.LargestUnit<T>;
  type SmallestUnit<T extends globalThis.Temporal.DateTimeUnit> =
    globalThis.Temporal.SmallestUnit<T>;
  type TotalUnit<T extends globalThis.Temporal.DateTimeUnit> = globalThis.Temporal.TotalUnit<T>;
  type DifferenceOptions<T extends globalThis.Temporal.DateTimeUnit> =
    globalThis.Temporal.DifferenceOptions<T>;
  type RoundTo<T extends globalThis.Temporal.DateTimeUnit> = globalThis.Temporal.RoundTo<T>;
}
