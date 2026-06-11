---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Event-Store-Doppelkodierungs-Fix, lokaler Event-Dispatcher in runProdApp, update-only entityEdit, actionForm-Extension-Kontext, konfigurierbare custom-fields-Rollen

- **fix(event-store):** `insertSubsequentEventRow` (und die es-ops-Raw-Inserts
  + `upsertSnapshot`) banden vor-stringifiziertes JSON an `::jsonb` — Bun.SQL
  kodiert einen JS-String erneut, gespeichert wurde ein jsonb-**String-Skalar**
  statt einem Objekt. Betroffen waren alle Events mit version>1 seit dem
  bun-db-Cutover. payload/metadata/state binden jetzt als Objekte; SQL-seitige
  Konsumenten (`payload->>'x'`, GDPR-Pipeline, Ops-Tools) sehen wieder echte
  Objekte. Bestandsdaten brauchen einen einmaligen Repair
  (`SET payload = (payload #>> '{}')::jsonb WHERE jsonb_typeof(payload)='string'`).
- **feat(runProdApp):** Lokaler Event-Dispatcher per Default an —
  Single-Container-Deployments hatten KEINEN Prozess, der
  `r.multiStreamProjection`-Projektionen anwendet (Read-Seiten blieben still
  leer). `createApiEntrypoint` bekommt `eventDispatcher: { runLocal: true }`
  (processLane "both"), runProdApp aktiviert das automatisch; Opt-out via
  `eventDispatcher: { disabled: true }` für Setups mit dezidiertem Worker.
- **feat(entityEdit):** `allowCreate?: boolean` / `allowDelete?: boolean`
  (Default true) für Lifecycle-Entities ohne CRUD-create/-delete: unterdrückt
  den automatischen „+ Neu"-Button auf entityList-Screens bzw. den
  Löschen-Button im Update-Form; Aufruf ohne entityId rendert bei
  `allowCreate: false` einen Fehler statt eines Create-Forms.
- **feat(actionForm):** Extension-Sections erhalten die initialen Form-Values
  (inkl. `?param=`-Prefill) als `initialValues` — Kontext-Sections wie eine
  Update-Timeline können den Row-Bezug daraus lesen.
- **feat(custom-fields):** `createCustomFieldsFeature({ valueWriteRoles,
  fieldDefinitionListRoles })` — Apps mit eigenem Rollen-Vokabular (z.B.
  "Admin"/"Editor") überschreiben damit die RBAC der von der
  CustomFieldsFormSection hart dispatchten Bundle-QNs (set/clear-custom-field,
  field-definition:list). Default unverändert TenantAdmin/TenantMember.
