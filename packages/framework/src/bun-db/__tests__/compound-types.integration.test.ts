// compound-types.integration.ts — Roundtrip-Tests für die entity-table-meta
// Compound-Field-Types die 2+ Spalten produzieren.
//
// money (field.type "money"):
//   <snake>            bigint  — Cent-Betrag (JS bigint, kein precision-loss)
//   <snake>_currency   text    — ISO-4217-Code
//   Read-keys (nach camelCase-Coercion in coerceRow): price / priceCurrency
//
// locatedTimestamp (field.type "locatedTimestamp"):
//   <snake>_utc  timestamptz — UTC-Zeitstempel (→ Temporal.Instant nach coerceRow)
//   <snake>_tz   text        — IANA-Timezone-Name
//   Read-keys nach camelCase-Coercion: dueAtUtc / dueAtTz
//
// Schreiben: snake_case-Keys werden von columnOf() korrekt gemappt.
// Lesen: coerceRow() renamed snake_case-DB-columns zu camelCase JS-keys.
import { afterAll, describe, expect, test } from "bun:test";
import { fetchOne, insertOne } from "../query";
import { closeDb, withTable } from "./_helpers";

afterAll(async () => {
  await closeDb();
});

const moneyCols = [
  { name: "price", pgType: "bigint" as const, notNull: true },
  { name: "price_currency", pgType: "text" as const, notNull: true, defaultSql: "'EUR'" },
] as const;

const locatedTsCols = [
  { name: "due_at_utc", pgType: "timestamptz" as const, notNull: true },
  { name: "due_at_tz", pgType: "text" as const, notNull: true },
] as const;

describe("money — roundtrip", () => {
  test("EUR-Betrag: insert + fetchOne gibt gleichen bigint + currency zurück", async () => {
    await withTable(moneyCols, async ({ db, meta }) => {
      const ins = await insertOne<{ id: string }>(db, meta, {
        price: 1234n,
        price_currency: "EUR",
      });
      const row = await fetchOne<{ price: bigint; priceCurrency: string }>(db, meta, {
        id: ins!.id,
      });
      expect(row!.price).toBe(1234n);
      expect(row!.priceCurrency).toBe("EUR");
    });
  });

  test("CHF-Currency roundtrip", async () => {
    await withTable(moneyCols, async ({ db, meta }) => {
      const ins = await insertOne<{ id: string }>(db, meta, {
        price: 9900n,
        price_currency: "CHF",
      });
      const row = await fetchOne<{ price: bigint; priceCurrency: string }>(db, meta, {
        id: ins!.id,
      });
      expect(row!.priceCurrency).toBe("CHF");
      expect(row!.price).toBe(9900n);
    });
  });

  test("JPY-Currency roundtrip (kein Cent, ganzer Yen)", async () => {
    await withTable(moneyCols, async ({ db, meta }) => {
      const ins = await insertOne<{ id: string }>(db, meta, {
        price: 150000n,
        price_currency: "JPY",
      });
      const row = await fetchOne<{ price: bigint; priceCurrency: string }>(db, meta, {
        id: ins!.id,
      });
      expect(row!.priceCurrency).toBe("JPY");
      expect(row!.price).toBe(150000n);
    });
  });

  test("großer Betrag (> 2^53 cents — bigint-Boundary, precision-loss-Guard)", async () => {
    await withTable(moneyCols, async ({ db, meta }) => {
      // JS Number max-safe ist 9007199254740991. Wert jenseits dieser Grenze
      // würde bei Number-Rückgabe still precision verlieren. bigint-Roundtrip
      // muss exakt bleiben.
      const bigCents = 9007199254740992n; // 2^53 — jenseits JS-Number-Grenze
      const ins = await insertOne<{ id: string }>(db, meta, {
        price: bigCents,
        price_currency: "EUR",
      });
      const row = await fetchOne<{ price: bigint }>(db, meta, { id: ins!.id });
      expect(row!.price).toBe(bigCents);
    });
  });
});

describe("locatedTimestamp — roundtrip", () => {
  test("UTC-Zeitstempel + Timezone-Name roundtrip (Europe/Berlin)", async () => {
    await withTable(locatedTsCols, async ({ db, meta }) => {
      const iso = "2026-05-24T08:30:00.000Z";
      const tz = "Europe/Berlin";
      const ins = await insertOne<{ id: string }>(db, meta, {
        due_at_utc: iso,
        due_at_tz: tz,
      });
      const row = await fetchOne<{ dueAtUtc: Temporal.Instant; dueAtTz: string }>(db, meta, {
        id: ins!.id,
      });
      // bun-db coerciert timestamptz → Temporal.Instant (coerceRow in query.ts)
      expect(typeof row!.dueAtUtc.epochNanoseconds).toBe("bigint");
      expect(row!.dueAtUtc.epochMilliseconds).toBe(new Date(iso).getTime());
      expect(row!.dueAtTz).toBe(tz);
    });
  });

  test("Timezone America/New_York bleibt als String erhalten", async () => {
    await withTable(locatedTsCols, async ({ db, meta }) => {
      const ins = await insertOne<{ id: string }>(db, meta, {
        due_at_utc: "2026-01-15T13:00:00.000Z",
        due_at_tz: "America/New_York",
      });
      const row = await fetchOne<{ dueAtTz: string }>(db, meta, { id: ins!.id });
      expect(row!.dueAtTz).toBe("America/New_York");
    });
  });

  test("UTC-Zeitstempel am Tag-Anfang (Mitternacht)", async () => {
    await withTable(locatedTsCols, async ({ db, meta }) => {
      const iso = "2026-01-01T00:00:00.000Z";
      const ins = await insertOne<{ id: string }>(db, meta, {
        due_at_utc: iso,
        due_at_tz: "UTC",
      });
      const row = await fetchOne<{ dueAtUtc: Temporal.Instant }>(db, meta, { id: ins!.id });
      expect(row!.dueAtUtc.epochMilliseconds).toBe(new Date(iso).getTime());
    });
  });
});
