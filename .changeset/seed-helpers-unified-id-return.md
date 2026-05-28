---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Unified return-type für alle event-store-Seed-Helper. Alle 5 seed-helpers liefern jetzt `Promise<{ id: ... }>` statt heterogener `string | TenantId | void | { id: string|number }`:

- `seedTextBlock`, `seedComplianceProfile` — Return-Type von `{ id: string | number }` zu `{ id: string }` (präzise, kein Generic-Inferenz-Verlust)
- `seedTenant` — Return-Type von `TenantId` zu `{ id: TenantId }`
- `seedTenantMembership` — Return-Type von `void` zu `{ id: string }` (membership-row-id)
- `seedUser`, `seedUserWithPassword`, `seedAdmin` — Return-Type von `string` zu `{ id: string }`

**Breaking:** Caller, die den Return verwenden, müssen destructuren:

```ts
// Vorher
const userId = await seedUser(db, { email, displayName });

// Jetzt
const { id: userId } = await seedUser(db, { email, displayName });
```

Caller, die den Return nicht nutzen (`await seedTenantMembership(...)`), sind unverändert.

Zusätzlich:
- `runEventStoreSeed<TId, TExisting>` — Generic-Parameter für die id-Spalte. Default `TId = string` hält die meisten Call-Sites unverändert. `TExisting`-Typ wird aus `existing`-Argument inferred.
- `TextBlockRow.id` von `string | number` auf `string` präzisiert (text_blocks.id ist uuid).
- `tenant/seeding.ts` + `user/seeding.ts` Helper-Kommentare präzisieren, dass die Helper add-only-Semantik haben (kein update-Pfad, kein `ifExists`-Knopf — Memberships/Tenant/User ändern läuft über den regulären Handler).
- Cast-Marker `// @cast-boundary db-row` über den beiden `result.data as ...`-Casts in `compliance-profiles/seeding.ts` und `text-content/seeding.ts` re-added.
