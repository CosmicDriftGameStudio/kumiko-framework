/**
 * Shared helpers für Qualified-Names (QN, z.B. "tickets:write:close").
 * Extrahiert aus guard-action-wiring.ts + guard-write-handler-qns.ts, die
 * beide eine byte-identische toKebab-Implementierung inline hatten.
 */

export function toKebab(s: string): string {
  return s
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

// Regex für ein gültiges Write-Handler-QN.
// Erlaubt 3 Segmente (feature:write:handler) oder 4+ (feature:write:entity:verb, feature:write:domain:entity:verb).
// Akzeptiert camelCase + kebab-case — Normalisierung auf kebab erfolgt vor Manifest-Match.
// Jedes Segment einzeln validiert (kein ":" im Segment-Zeichensatz) — sonst
// akzeptiert die letzte Segment-Gruppe trailing/doppelte Colons wie
// "tickets:write:close:" als valide.
export const VALID_QN_RE =
  /^[a-zA-Z][a-zA-Z0-9-]*:write:[a-zA-Z][a-zA-Z0-9-]*(:[a-zA-Z][a-zA-Z0-9-]*)*$/;
