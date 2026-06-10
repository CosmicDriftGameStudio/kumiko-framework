# compliance-profiles-demo

Sample-Recipe: gleicher App-Code, drei Tenants, drei DSGVO-Profile.

## Was es zeigt

Wie ein Multi-Tenant-Plattform-Setup mit `compliance-profiles` ohne
Code-Branches unterschiedliches regulatorisches Verhalten pro Tenant
liefert:

| Tenant | Profile | Aufsicht | Sprachen | Tenant-Destroy-Grace |
|---|---|---|---|---|
| **A** (DACH) | `eu-dsgvo` | BlnBDI Berlin | de / en | 30 Tage |
| **B** (Schweiz) | `swiss-dsg` | EDÖB Bern | de / fr / it / en | 30 Tage |
| **C** (DACH-HR) | `de-hr-dsgvo-hgb` | Landes-Datenschutzbehörde | de | 60 Tage (HR-Override) |

Plus dass Tenant B mit einem Override (`gracePeriod: { days: 90 }`)
seine User-Rights-Grace verlängern kann ohne andere Profil-Felder zu
verlieren — Deep-Merge auf Base-Profile, atomic-paths ersetzen, Rest
geerbt aus `swiss-dsg` (das selbst extends auf `eu-dsgvo`).

## Architektur-Demo

Das Sample importiert nur ein Feature:

```ts illustration
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";

export const features = [createComplianceProfilesFeature()];
```

Das Feature exposed `r.exposesApi("compliance.forTenant")` — andere
Features (Sprint 2 `user-data-rights`, Sprint 5 `tenant-lifecycle`)
nutzen den Resolver via QN-Pattern (siehe legal-pages →
text-content für Cross-Feature-Aufruf-Beispiel).

## Tests laufen

```bash
# Aus dem framework-Repo-Root (kumiko-framework):
bun test
  samples/recipes/compliance-profiles-demo/src/__tests__/feature.integration.test.ts

# Alle Integration-Tests (incl. dieses Sample):
bun test
```

5 Tests, alle full-stack via `setupTestStack` + echte HTTP-Calls.

## Local-Dev-Setup (manueller Test)

Das Sample ist ein Recipe ohne eigenen Server-Bootstrap — die Tests
fahren `setupTestStack` und sind self-contained. Wer das interaktiv
ausprobieren will, bindet `complianceProfilesDemoFeatures` in seine
eigene `runDevApp`-Konfiguration ein.

## Nächste Schritte (Sprint 2+)

- Sprint 2 `user-data-rights` ruft `compliance.forTenant` für Forget-
  Grace-Period (eu-dsgvo: 30d, ca-quebec-l25: 30d, hipaa: 30d, …)
- Sprint 5 `tenant-lifecycle` ruft es für `tenantDestroyGracePeriod`
- Sprint 9 `compliance-as-product` Generator nutzt das Profile für
  Verarbeitungsverzeichnis (Art. 30) + TOMs (Art. 32)
