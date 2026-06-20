// Trial-Phase: ein neuer Tenant bekommt für eine Karenzzeit ab seinem
// Anlage-Datum (inserted_at der tier-assignment-Row — rebuild-stabil aus dem
// Create-Event) zusätzlich die Features eines höheren Tiers, unabhängig vom
// gespeicherten Tier. Rein zeit-abgeleitet: kein Stored-Flag, kein Scheduler,
// automatischer Ablauf. Die App definiert die Policy (welcher Tier, wie lange);
// die tier-engine wendet sie im Resolver an.

export interface TrialPolicy {
  // Tier, dessen Features während der Trial-Phase zusätzlich freigeschaltet
  // werden (muss ein Key der tierMap sein, sonst greift kein Feature).
  readonly tier: string;
  // Länge der Trial-Phase ab inserted_at, in Stunden (720 = 30 Tage). Stunden
  // statt Tage: Temporal.Instant kennt keine Kalender-Tage, 720h ist die
  // ehrliche, DST-unabhängige Dauer.
  readonly durationHours: number;
}

// Reine Millis-Arithmetik auf epochMilliseconds (die beide Seiten — Projektions-
// Row und Now — liefern). Kein Date, keine TZ.
export function isTrialActive(
  startedAtEpochMs: number,
  nowEpochMs: number,
  durationHours: number,
): boolean {
  return nowEpochMs < startedAtEpochMs + durationHours * 3_600_000;
}
