---
status: reference
verified: 2026-08-30
evidence: "kumiko-framework#2306 (custom-fields/secrets role configurability); packages/bundled-features/src/custom-fields/constants.ts; packages/bundled-features/src/secrets/feature.ts"
---

# Feature-API: konfigurierbare Rollen (`createCustomFieldsFeature`, `createSecretsFeature`)

Mehrere Bundled-Features gaten ihre Schreib-/Lese-Operationen über hart
gesetzte Rollen. Neu lassen sich diese über Feature-Optionen an die
Rollen-Vokabulare des Hosts anpassen (fw#2306).

## `createCustomFieldsFeature` — Write-/List-Rollen

Drei Optionen steuern, wer Custom-Field-Werte bzw. Feld-Definitionen lesen
und schreiben darf:

| Option | Default | Gate |
|--------|---------|------|
| `valueWriteRoles` | `["TenantAdmin", "TenantMember"]` | Werte schreiben (setzen/aktualisieren) |
| `fieldDefinitionListRoles` | `["TenantAdmin"]` | Feld-Definitionen auflisten |
| `fieldDefinitionWriteRoles` | `["TenantAdmin"]` | Feld-Definitionen anlegen/aktualisieren/löschen |

Hosts ohne Plattform-Admins können `fieldDefinitionWriteRoles` an ihr eigenes
Rollen-Vokabular binden. Werte-Writes sind standardmäßig für `TenantMember`
offen; eine restriktivere `valueWriteRoles` schränkt das ein.

## `createSecretsFeature` — `access`-Regel

`set`/`delete`/`list` teilen sich EINE Zugriffsregel (einheitlicher
Blast-Radius, kein per-Handler-Drift):

```
createSecretsFeature({ access: { roles: ["TenantAdmin"] } })
createSecretsFeature({ access: { openToAll: true } })
```

- **Default:** `{ roles: ["TenantAdmin"] }` — nur Admins lesen/werten/schreiben.
- **`{ roles: [...] }`** — an das Rollen-Vokabular des Hosts angepasst.
- **`{ openToAll: true }`** — jeder authentifizierte Tenant-User darf
  Secret-Previews lesen und Secrets schreiben/löschen.

> `openToAll: true` vergrößert die Blast-Radius erheblich — Secret-Previews
> und Writes sind dann nicht mehr auf Admins beschränkt. Nur setzen, wenn
> das Produkt es wirklich verlangt; sonst Default oder `roles`.
