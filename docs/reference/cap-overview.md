---
status: reference
verified: 2026-08-30
evidence: "kumiko-framework#2496 (feat/cap-overview); #2503 (drei Caps, Tone); #2515 (not-measured); admin-shell Opt-in Nav (602174b77); bundled-features/cap-overview"
---

# cap-overview: Tier- und Cap-Usage-Dashboards

Read-only-Dashboards über Plan-Tier, Billing und Cap-Usage, für Sysadmins
(Plattform) und Tenant-Admins (eigenes Tenant). Baut auf `tenant`,
`tier-engine`, `billing-foundation` und `cap-counter` auf. Bundled Feature:
`packages/bundled-features/src/cap-overview/`.

## Nutzung

`createCapOverviewFeature({ caps, listCaps?, tiers? })` registriert die
Dashboards.

- **`caps: readonly CapSpec[]`** (Pflicht) — die zu überwachenden Usage-Caps.
- **`listCaps?`** — welche Caps als Spalten auf dem Platform-Screen
  (`tenant-cap-list`) erscheinen; Default = die ersten drei, wenn weggelassen.
- **`tiers?`** — optionale Werte für den Tier-Facet-Filter der Platform-Liste.
  Weggelassen → **kein** Facet (die Engine trägt keine eigene Tier-Vokabular-
  Enumeration, aus der man eines ableiten könnte; "Filter by tier" war explizit
  angefragt — `tiers` weglassen droppt den Filter bewusst, kein Default).

## Registrierte Screens

| Screen | Zweck |
|---|---|
| `tenant-cap-list` | Plattform-Liste aller Tenants, eine Cap-Spalte pro `listCaps`-Eintrag, optionaler Tier-Facet. |
| `my-caps` | Cap-Usage-Dashboard des eigenen Tenants (Tenant-Admin). |
| `platform-tenant-caps` | Drilldown für einen einzelnen Tenant über dessen Caps. |

## UI-Anbindung

- **Opt-in Nav** (fw#2505): Einbindung in den `admin-shell`-Nav ist opt-in
  über `includeCapOverview` — wird nicht automatisch eingeblendet.
- **Over-Cap-Tone**: Der `Progress`-Primitive (renderer) trägt jetzt einen
  `tone` (`default`/`warn`/`danger`), damit usage-Bars jenseits des Caps als
  Over-Cap lesen statt nur als voller Balken.
- Dashboard-Stat-Panels greifen auf Usage-Query-Handler zu
  (`caps-usage.query`, `tenant-caps-list.query`, `tenant-options.query`),
  deren Felder vom Boot-Validator gegen das outputSchema geprüft werden
  (siehe `docs/reference/boot-validator.md`).

Siehe auch: `docs/reference/boot-validator.md` (Dashboard-Output-Felder gegen
outputSchema), `docs/reference/tier-composition-boot-vs-runtime.md`.
