// Trial phase: a new tenant receives the features of a higher tier for a grace
// period starting at its creation date (`inserted_at` of the tier-assignment Row —
// stable across rebuilds because it comes from the Create Event), regardless of
// the stored tier. It is derived solely from time: no stored flag, no scheduler,
// and automatic expiration. The app defines the policy (which tier, how long);
// the tier-engine applies it in the resolver.

export interface TrialPolicy {
  // Tier whose features are additionally enabled during the trial phase
  // (must be a key in tierMap; otherwise no feature takes effect).
  readonly tier: string;
  // Length of the trial phase from inserted_at, in hours (720 = 30 days). Hours
  // are used instead of days because Temporal.Instant has no calendar days; 720h
  // is the accurate, DST-independent duration.
  readonly durationHours: number;
}

// Pure millisecond arithmetic on epochMilliseconds, which both sides—the
// projection Row and Now—provide. No Date and no time zone.
export function isTrialActive(
  startedAtEpochMs: number,
  nowEpochMs: number,
  durationHours: number,
): boolean {
  return nowEpochMs < startedAtEpochMs + durationHours * 3_600_000;
}
