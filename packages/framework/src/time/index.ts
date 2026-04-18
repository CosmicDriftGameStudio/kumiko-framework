// Time-Modul: Temporal-Polyfill + (kommt) ctx.tz Helper, Field-Typen,
// DB-Wrapper, Zod-Validatoren.
//
// Aktueller Stand (Phase 1 von Gap-03 in samples/beammycar/MIGRATION.md):
//   - ensureTemporalPolyfill: installiert Temporal global wenn nötig
//   - getTemporal: type-safer Zugriff auf globalThis.Temporal
// Kommt:
//   - locatedTimestamp(name) Helper für Entity-Field-Definitionen
//   - "timestamp" / "date" / "tz" Field-Typen + Zod-Validatoren
//   - DB-Wrapper (Wall-Clock+tz ↔ UTC transparent)
//   - ctx.tz Helper-API
//   - UI-Komponenten

export { ensureTemporalPolyfill, getTemporal } from "./polyfill";
