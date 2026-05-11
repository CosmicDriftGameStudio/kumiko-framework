// DurationSpec ↔ SQL-Interval ↔ Temporal.Duration converter.
//
// Hintergrund: ComplianceProfile.userRights.gracePeriod ist
// `{ days: number } | { hours: number }` (Discriminated Union). Caller
// die das in eine Postgres-`interval`-SQL einsetzen brauchen einen
// einzigen vertrauenswuerdigen Punkt, sonst springt ein
// `{ hours: 6 }`-Override stillschweigend auf einen days-Default.
//
// Single source of truth: hier. Andere Spec-Forms (months/years) im
// retention-Pfad gehen ueber den breiteren `keep-for`-Parser, sind hier
// bewusst nicht abgedeckt — das engt den Type ein und macht die SQL-
// Renderung total.

import { getTemporal } from "../time";
import type { DurationSpec } from "./profiles";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

// Spec in Millisekunden. Source of truth fuer alle Konvertierungen
// (Instant-add, optional fuer JS-Datumsrechnung).
export function durationSpecToMs(spec: DurationSpec): number {
  if ("days" in spec) return spec.days * 24 * 60 * 60 * 1000;
  return spec.hours * 60 * 60 * 1000;
}

// Frist berechnen ohne DB-now() — der App-Server-Clock ist
// authoritative. Fuer Forget-Grace, Token-TTLs und Frist-Setzungen
// where eine Toleranz von wenigen ms zwischen App und DB irrelevant
// ist (Grace-Periods >= 6h, Tokens >= Minuten).
//
// Schreibt direkt in `instant()`-customType-Spalten — kein interval-
// SQL-Fragment, kein Codec-Bypass.
export function addDurationSpec(now: Instant, spec: DurationSpec): Instant {
  return getTemporal().Instant.fromEpochMilliseconds(
    now.epochMilliseconds + durationSpecToMs(spec),
  );
}

// Lesbare Beschreibung fuer Logs / Error-Messages. Nicht i18n —
// English-only-Operator-Output.
export function describeDurationSpec(spec: DurationSpec): string {
  if ("days" in spec) return `${spec.days} day${spec.days === 1 ? "" : "s"}`;
  return `${spec.hours} hour${spec.hours === 1 ? "" : "s"}`;
}
