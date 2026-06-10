# compliance-profiles

Tenant-weite DSGVO/Compliance-Profile-Wahl. Pflicht beim Tenant-Onboarding —
Profile bündelt User-Rights-Grace, Notification-Sprachen, Breach-
Disclosure, Audit-Retention und Sub-Processor-Anforderungen in eine
Auswahl.

**Status:** Sprint 1 (S1.1 + S1.3). Sub-Processor-Endpoint (S1.4) und
Onboarding-Banner-API (S1.5) folgen in derselben Sprint-Iteration.

## MVP-Set: 3 Profile

- **`eu-dsgvo`** — Foundation-Profile, DSGVO Standard, BlnBDI Berlin
- **`swiss-dsg`** — extends `eu-dsgvo` mit DE/FR/IT/EN-Sprachen + EDÖB
- **`de-hr-dsgvo-hgb`** — extends `eu-dsgvo` mit HR-Spezifika (HGB
  10y-Audit-Retention, Betriebsrat-Notification, 60d-Tenant-Destroy)

Plus `minimal-no-region` als Default-Fallback (NICHT auswählbar) bis
Tenant-Admin eine Wahl trifft.

Erweiterungen wie `uk-gdpr`, `ca-pipeda`, `ca-quebec-l25`, `us-ccpa`,
`hipaa-healthcare` kommen on-demand wenn Customer fragt — der
`extends`-Mechanismus macht sie zu 30-Zeilen-Adds.

## API

### Queries

- `compliance-profiles:query:list-profiles` — `openToAll`. Liefert die
  3 wählbaren Profile mit Region + Aufsicht + Sprachen, für Onboarding-UI.
- `compliance-profiles:query:for-tenant` — `openToAll`. Liefert das
  effektive Profile für den aktuellen Tenant inkl. Override (deep-merge).
  Wenn kein Profile gesetzt: `minimal-no-region` + `warning="no-profile-selected"`.

### Writes

- `compliance-profiles:write:set-profile` — `roles=[TenantAdmin]`.
  Upsert: setzt `profileKey` (+ optional `override`-JSON) für den
  aktuellen Tenant. Idempotent, zweiter Call updated.

### Cross-Feature (`r.exposesApi`)

- `compliance.forTenant` — Marker. Andere Features (Sprint 2
  `user-data-rights`, Sprint 5 `tenant-lifecycle`) rufen den Resolver via
  QN-Pattern (`app.fetch("/api/query")` mit `type=compliance-profiles:query:for-tenant`).
  Boot-Validator checkt dass jeder `r.usesApi("compliance.forTenant")`-
  Caller das Feature in `requires/optionalRequires` hat.

## Override-Semantik

`override` wird als JSON-String gespeichert und beim Resolver
deep-merged auf das gewählte Profile. Atomic-Paths (gracePeriod /
auskunftFrist / retention / authorityNotificationDeadline /
tenantDestroyGracePeriod) ersetzen komplett statt rekursiv zu mergen,
weil sie diskriminierte Union-Objects sind (`{ months } | { years }` vs
`{ days } | { hours }`).

```typescript
// Tenant-Admin override:
{
  "userRights": { "gracePeriod": { "days": 60 } }
}
// Effekt auf eu-dsgvo:
//   userRights.gracePeriod = { days: 60 }     (overridden)
//   userRights.restrictionAllowed = true       (geerbt)
//   userRights.portabilityFormat = ["json"]    (geerbt)
//   ...alle anderen userRights-Felder unverändert
```

## Architektur-Note

Profile-Selection lebt als **separate Entity** (`tenantComplianceProfileEntity`)
im compliance-profiles-Feature, nicht als config-key im tenant-Feature.
Begründung in `schema/profile-selection.ts` — kurz: Override ist
strukturiertes JSON, Profile-Wechsel ist audit-relevant (Event-Store
liefert das automatisch für Entity-Writes), Plan-Files nennen sie
explizit als eigene Entity.

## Tests

`__tests__/compliance-profiles.integration.test.ts` — 9 full-stack Tests via
`setupTestStack` + echte HTTP-Calls (Memory: `feedback_no_fake_dispatcher`):
list-profiles, for-tenant ohne/mit Setting, set-profile als TenantAdmin /
Member (403) / mit Override / mit invalidem JSON / mit Array statt Object /
idempotent-Update.

Plus Unit-Tests für Profile-Constants + Override-Resolver in
`framework/src/compliance/__tests__/profiles.test.ts` (16 Tests).
