import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import type { ExpiryState } from "./constants.ts";

export type ExpiryWindow = {
  readonly today: string;
  /** Last day (inclusive) that still counts as "expiring". */
  readonly horizon: string;
};

// One definition of the boundaries for the counts and for the per-row state, so the
// overview column and the expiry-overview buckets cannot drift apart.
export function expiryWindow(
  ctx: Pick<HandlerContext, "tz">,
  expiringWithinDays: number,
): ExpiryWindow {
  const today = ctx.tz.today(ctx.tz.tenant);
  return { today: today.toString(), horizon: today.add({ days: expiringWithinDays }).toString() };
}

// In-process dispatch hands back the date as a PlainDate, the wire form is an ISO string.
// ISO dates compare correctly as strings; a missing date is "none", not "valid".
export function expiryStateOf(validUntil: unknown, window: ExpiryWindow): ExpiryState {
  const day =
    validUntil instanceof Temporal.PlainDate
      ? validUntil.toString()
      : typeof validUntil === "string"
        ? validUntil.slice(0, 10)
        : "";
  if (day === "") return "none";
  if (day < window.today) return "expired";
  return day <= window.horizon ? "expiring" : "valid";
}
