# DSGVO Compliance — Operator-Guide

Dieses Dokument bündelt die **technischen Fakten** zur DSGVO-Pipeline
(Art. 15/17/18/20) als Grundlage für:

- **Verarbeitungsverzeichnis** (Art. 30) — was wird wo wie lange gespeichert
- **Datenschutzerklärung** — welche Endpoints decken welchen Artikel ab
- **AVV mit Sub-Processors** — welche TOM sind eingebaut
- **Operator-Runbook** — was triggert wann, wer kann was sehen

> Juristische Texte (AVV-Wortlaut, Datenschutzerklärung-Bausteine,
> Verarbeitungsverzeichnis-Strukturierung) gehören zu Marc + Anwalt —
> dieses Dokument liefert nur die technischen Fakten dafür.

---

## 1. Endpoint → Artikel-Mapping

| Artikel | Endpoint / Runner | Wer ruft auf | Was passiert |
|---------|-------------------|--------------|--------------|
| **Art. 15 (Auskunft, light)** | `user-data-rights:query:my-audit-log` | User | Liest eigene Framework-Events aus `kumiko_events` (account-weit über alle Memberships). Filterbar nach `eventType`, `aggregateType`, `from`/`to`. Domain-Entities ohne `ctx.appendEvent` erscheinen NICHT — die kommen im Export-Bundle (Art. 20). |
| **Art. 15 + 20 (Auskunft + Portabilität)** | `user-data-rights:write:request-export` | User | Async Job → ZIP mit user-Profil + fileRefs + alle EXT_USER_DATA-Provider-Daten (cross-tenant) + signed Magic-Link per Email. Idempotent: nur 1 active Job pro User (`ACTIVE_JOB_CONSTRAINT`). |
| **Art. 15 + 20** | `GET /user-export/by-token?token=…` | Anonym (Magic-Link-Pfad) | Token-Hash-Lookup → 302-Redirect auf signed Storage-URL. Multi-use innerhalb TTL. Audit: `lastUsedAt`, `lastUsedFromIp`, `lastUsedUserAgent`. |
| **Art. 15 + 20** | `GET /user-export/by-job/:jobId` | User (Session-Auth) | UI-Klick-Pfad. Cross-tenant-same-user: User in Tenant B kann Job aus Tenant A laden wenn er der Owner ist. |
| **Art. 17 (Löschung)** | `user-data-rights:write:request-deletion` | User | Soft-Delete: `status=DeletionRequested` + `gracePeriodEnd = now + profile.gracePeriod`. Cron `run-forget-cleanup` führt nach Grace die Anonymisierung durch. |
| **Art. 17** | `user-data-rights:write:cancel-deletion` | User | Während Grace: status zurück auf `Active`. |
| **Art. 17** | `run-forget-cleanup` (Cron) | System | Findet User mit `status=DeletionRequested AND gracePeriodEnd < now`. Pro User Sub-TX über alle EXT_USER_DATA-Provider mit Strategy aus `retention.policyFor`. user-Hook anonymisiert (PII raus, Sentinel-Email). |
| **Art. 18 (Restriction)** | `user-data-rights:write:restrict-account` | Admin / SystemAdmin | Status-Flip → Auth-Middleware-Guard blockt Logins. `sessions.revokeAllForUser` killt aktive Sessions. |
| **Art. 18** | `user-data-rights:write:lift-restriction` | Admin / SystemAdmin | Restriction aufheben. |
| **Operator (DPO)** | `user-data-rights:query:list-download-attempts` | Admin / SystemAdmin | Brute-Force-Detection: zeigt invalid Download-Versuche (notFound / expired / failed / signedUrlNotSupported) gefiltert nach Result, IP, Zeitraum. |

---

## 2. Speicherorte (Verarbeitungsverzeichnis Art. 30)

| Tabelle | Inhalt | Personenbezug | Retention | Zweck |
|---------|--------|---------------|-----------|-------|
| `read_users` | User-Profil (email, displayName, passwordHash, locale, status, gracePeriodEnd, roles) | direkt | per Domain (typ. blockDelete bei Aufbewahrungspflicht, sonst hardDelete via Forget-Pipeline) | Authentifizierung, Nutzer-Profil |
| `read_tenant_memberships` | User↔Tenant-Verknüpfung + Rollen | direkt (via userId) | per Tenant-Lifecycle | Mehrmandant-Zuordnung |
| `kumiko_events` | Event-Store (alle write-Events) | direkt (`createdBy = userId`) | per Domain-Policy via `data-retention` | Audit-Trail (Art. 15-Selbstauskunft Quelle), Event-Sourcing |
| `read_export_jobs` | Async Export-Status (queued/running/done/failed), userId, requestedAt, doneAt, storageKey | direkt (userId) | per `compliance-profiles` Profil-Default | Idempotenz + Status-Polling |
| `read_export_download_tokens` | Magic-Link-Hash (SHA-256), TTL, useCount, lastUsedAt, lastUsedFromIp, lastUsedUserAgent | indirekt (Token→Job→User) | `compliance-profiles.userRights.exportDownloadTtl` (default 7d) | Magic-Link-Auth + Multi-Use-Audit |
| `read_download_attempts` | Invalid Download-Versuche: result, via, tokenHash, ip, userAgent, attemptedAt | indirekt (IP) | **90d hardDelete** (Entity-Default, Disk-Bomb-Schutz) | DPO-Brute-Force-Detection |
| `read_tenant_compliance_profiles` | Per-Tenant Profile-Wahl + Override | nein | unbounded (Konfiguration) | Region-/Branchen-Defaults |
| `read_tenant_retention_overrides` | Per-Tenant Retention-Override pro Entity | nein | unbounded (Konfiguration) | Aufbewahrungspflicht-Edge-Cases |
| Storage-Provider (Local / S3) | Export-ZIPs + File-Binaries | indirekt (Inhalt) | Local: per `exportDownloadTtl` Cleanup. S3: lifecycle-Policy (App-Author-Verantwortung) | Daten-Export-Auslieferung |

### Bekanntes Residuum: `createdBy` / `metadata.userId` in `kumiko_events`

Nach der Forget-Pipeline (Art. 17, Abschnitt 1) bleiben `kumiko_events.created_by`
und `metadata.userId` (Event-Store-Schema `events-schema.ts`, EventMetadata-Feld)
als Klartext-UUID stehen. Die Forget-Hooks aus `user-data-rights-defaults` fassen
`kumiko_events` nicht an — `createdBy`/`metadata.userId` sind keine über
`defineEvent(..., { piiFields })` deklarierten Payload-PII-Felder (siehe
`packages/framework/src/crypto/event-pii.ts`) und laufen deshalb nicht durch die
Payload-Verschlüsselung. Löschung dieser Rows erfolgt ausschließlich über die
zeitbasierte `data-retention`-Policy (`keepFor`, s. `kumiko_events`-Zeile in Abschnitt
2 oben), unabhängig vom User-Forget-Antrag.

Technische Basis: Der `read_users`-Row zur betroffenen UUID wird beim Forget-Run
in-place anonymisiert, nicht hard-gelöscht (Sentinel-Pattern, siehe Abschnitt 4
„Integrität"). Email, Displayname und Passwort-Hash werden dabei entfernt/ersetzt —
das ist der Schlüssel, der die Verknüpfung kappt: Sobald diese Felder weg sind, gibt
es keinen Rückweg von der UUID in `created_by` zu einer realen Identität mehr. Die
UUID bleibt als stabiler, aber orphaned Pseudonym-Wert bestehen, bis die
Retention-Policy irgendwann das Event selbst löscht.

---

## 3. Compliance-Profile

| Profil | gracePeriod | exportDownloadTtl | Stale-After | Sub-Processors |
|--------|-------------|-------------------|-------------|----------------|
| `eu-dsgvo` | 30d | 7d | 30d | per Tenant konfigurierbar |
| `swiss-dsg` | 30d | 7d | 30d | + EDÖB-Meldepfad |
| `de-hr-dsgvo-hgb` | 30d | 7d | 30d | + HR-Aufbewahrung 10y für HR-Entities (anonymize statt delete) |
| `minimal-no-region` | 30d | 7d | 30d | Migration-Edge-Case ohne Region |

Tenant kann via `compliance-profiles:write:set-profile` + Override (`override.userRights.gracePeriod={ days: N }` etc.) eigene Werte setzen.

---

## 4. Technische und Organisatorische Maßnahmen (TOM)

Eingebaute Schutzmaßnahmen — können 1:1 in den AVV-Anhang "Technische
und Organisatorische Maßnahmen" übernommen werden:

### Vertraulichkeit / Zugriffskontrolle

- **Magic-Link-Token-Hashing**: Plain-Token landet NIE in DB / Event-Store. SHA-256-Hash via `crypto.subtle.digest` (Web-Crypto-API). Plain-Token kommt nur ephemeral via Email-Callback an die App-Author-Implementation.
- **Download-Token Multi-Use within TTL**: kein consume-on-use (Pattern Google Takeout) — User kann ZIP mehrfach laden, aber TTL gilt absolut.
- **Audit-Felder am Token**: useCount, lastUsedAt, lastUsedFromIp, lastUsedUserAgent. Operator sieht ob Token mehrfach verwendet wurde, von welcher IP.
- **Account-weite Auskunft via `ctx.db.raw`**: `my-audit-log` umgeht TenantDb-Auto-Filter explizit (Account-weite Sicht für Art. 15 ist Pflicht); Sicherung über hard-coded `WHERE createdBy = ctx.user.id` (kein userId-Parameter, kein Cross-User-Snooping möglich).
- **Cross-User-Schutz im Download-Pfad**: `download-by-job` checkt `jobRow.userId === session.user.id` — User kann nur eigene Jobs laden.
- **Restriction killt Sessions**: `restrict-account` triggert `sessions.revokeAllForUser` — restricted User kann existierende Tabs nicht weiternutzen.

### Integrität

- **Event-Sourcing first-class**: alle DSGVO-Schreib-Operationen (request-deletion, restrict, lift, request-export) sind Events im `kumiko_events`-Store mit `version_conflict`-Schutz.
- **Forget-Strategy aus `data-retention`**: Cleanup-Runner konsultiert `retention.policyFor` pro Entity — `blockDelete` für gesetzliche Aufbewahrungspflicht (HR/HGB), `anonymize` als Alternative zu `hardDelete`.
- **Strategy-respect-Pattern in Default-Hooks**: user-Hook anonymisiert mit Sentinel-Pattern `deleted-<id>@anonymized.invalid` — Unique-Constraint + FK-Refs bleiben intakt.

### Verfügbarkeit / Belastbarkeit

- **Best-Effort-Audit beim Download**: Audit-INSERT in `read_download_attempts` ist `try/catch` swallowed — Audit-Failure killt nicht den User-facing 4xx.
- **Idempotenz im Export-Job**: `ACTIVE_JOB_CONSTRAINT` (UNIQUE-Index auf `(userId, status='active')`) verhindert Doppel-Jobs. Worker-Crash → Job bleibt `running`, Recovery-Pfad via Job-Run-Tracking aus `jobs`-Feature.
- **Per-User Sub-TX im Forget-Runner**: Ein User-Hook-Throw rollback'd nur diesen User; andere User im Batch laufen weiter.
- **Best-Effort-Notification-Callbacks**: send-Throw für Job A killt nicht Batch B/C (Memory: Atom 5.fix3).

### Brute-Force-Schutz

- **Edge-Rate-Limit auf Download-Endpoint**: `rateLimit: { per: "ip", limit: 30, windowSeconds: 60 }` für `download-by-token`.
- **Download-Attempt-Audit** mit 90d hardDelete: invalid Versuche werden persistiert für DPO-Detection, Tabelle ist begrenzt → kein Disk-Bomb durch Brute-Force.
- **Token-Hash-Suchraum**: 32-Byte-Random = 256 Bit, Brute-Force über Edge-Limit praktisch nicht möglich.

### Zweckbindung / Datenminimierung

- **Export-Bundle Default-PII-Filter**: user-Hook entfernt `passwordHash`, `roles`, `status` aus dem Bundle (App-Author kann das per Custom-Hook überschreiben).
- **fileRefs separat**: Export-Bundle enthält Datei-Metadaten (id, fileName, mimeType, size); Binaries werden via signed-URL separat ins ZIP gepackt — kein Inline-Base64-Memory-Druck.

### Auftragskontrolle (gegenüber Sub-Processors)

- **Storage-Provider als Plugin** (`file-foundation` + `file-provider-{s3,inmemory}`): App-Author wählt Provider; AVV mit S3-Hoster (Hetzner / AWS) ist vom Provider abhängig.
- **Email-Transport als Plugin** (`mail-foundation` + `mail-transport-{smtp,inmemory}`): SMTP / SES / Resend per Plugin austauschbar.
- **`compliance-profiles:query:sub-processors`**: Per-Tenant Liste der aktiven Sub-Processors, abrufbar für AVV-Anhang.

---

## 5. Cron-Jobs / Operationale Trigger

| Job | Trigger | Was passiert | Operator-Sichtbarkeit |
|-----|---------|--------------|------------------------|
| `run-forget-cleanup` | Cron (per App-Author konfigurierbar, typisch täglich) | Findet User mit abgelaufener Grace, ruft `EXT_USER_DATA.delete` pro Provider, anonymisiert User, sendet `sendDeletionExecutedEmail`-Callback | `read_job_runs` (success/fail), Hook-Errors als `errors[]` im Result |
| `run-export-jobs` | Cron + Event-getriggert | Findet pending Export-Jobs, ruft `runUserExport` → ZIP-Bau → Storage-Upload → Magic-Link-Token → `sendExportReadyEmail` | `read_job_runs`, `read_export_jobs.status` |
| `data-retention-cleanup` | Cron (in `data-retention`) | Cleant abgelaufene Rows pro Entity per `retention.keepFor` | `read_job_runs` |
| Token-Cleanup (implizit) | Per `compliance-profiles.userRights.exportDownloadTtl` | Worker-Job entfernt expired Magic-Link-Tokens + Storage-Binaries | `read_export_download_tokens` |
| Download-Attempt-Cleanup | Per Entity-Default 90d | Cleant `read_download_attempts` | — |

App-Author registriert die Cron-Trigger im run-config; `jobs`-Feature
persistiert Run-Tracking + Retry-Pfad.

---

## 6. Doku-Snippets für Marc

### Datenschutzerklärung — Betroffenenrechte

> **Recht auf Auskunft (Art. 15 DSGVO):** Sie können jederzeit eine
> Kopie aller bei uns über Sie gespeicherten Daten anfordern. Über die
> Funktion "Daten exportieren" in den Account-Einstellungen erhalten
> Sie ein vollständiges JSON-/ZIP-Bundle Ihrer Profildaten, hochgeladenen
> Dateien und [App-Author: Domain-Daten ergänzen] per signed Magic-Link
> auf Ihre hinterlegte E-Mail-Adresse. Der Link ist 7 Tage gültig.

> **Recht auf Löschung (Art. 17 DSGVO):** Über "Account löschen" können
> Sie Ihren Account jederzeit zur Löschung vormerken. Es gilt eine
> Karenzzeit von 30 Tagen, in der Sie den Antrag widerrufen können
> (Funktion "Löschung widerrufen"). Nach Ablauf werden Ihre Daten
> automatisch gelöscht oder anonymisiert. Daten mit gesetzlicher
> Aufbewahrungspflicht (z. B. Rechnungen nach §147 AO) bleiben bis zum
> Fristablauf gesperrt erhalten und werden danach automatisch gelöscht.

> **Recht auf Einschränkung (Art. 18 DSGVO):** Auf begründeten Antrag
> kann Ihr Account temporär gesperrt werden. Während der Sperre können
> Sie sich nicht mehr einloggen, Ihre Daten werden aber nicht gelöscht
> oder verändert.

### AVV-TOM-Anhang

Für den AVV-Anhang "Technische und Organisatorische Maßnahmen" siehe
**Abschnitt 4** dieses Dokuments — komplette Liste mit Verweisen auf
die Code-Implementierung.

### Verarbeitungsverzeichnis

Spalte "Speicherorte / Empfänger" → siehe **Abschnitt 2** (Tabellen-
Übersicht). Spalte "Löschfristen" → siehe **Abschnitt 3** + Spalte
"Retention" in Abschnitt 2.

---

## 7. Was NICHT in diesem Framework abgedeckt ist

Bewusst ausserhalb — App-Author-Verantwortung:

- **Auswahl + AVV mit konkretem Storage-Provider** (Hetzner / AWS / etc.)
- **Auswahl + AVV mit konkretem Email-Provider** (SMTP-Host / SES / Resend)
- **Datenpannen-Meldung** an Aufsichtsbehörde (organisatorisch, nicht technisch)
- **DSFA** (Datenschutz-Folgenabschätzung) — Framework liefert die TOM-Inputs, App-Author macht die Bewertung
- **Cookie-Consent-Layer** (das ist Frontend-Sache + separate consent-Feature, nicht Teil von user-data-rights)
- **Tenant-Lifecycle-Destroy** (Account-Löschung des Tenants selbst, nicht der User darin) — kommt als separates `tenant-lifecycle`-Feature in Sprint 5

---

## Referenzen

- Code: `packages/bundled-features/src/user-data-rights/`
- Default-Hooks: `packages/bundled-features/src/user-data-rights-defaults/`
- Compliance-Profile: `packages/bundled-features/src/compliance-profiles/`
- Retention-Engine: `packages/bundled-features/src/data-retention/`
- Sample-App: `samples/apps/user-data-rights-demo/`
- Tests: `packages/bundled-features/src/user-data-rights/__tests__/` (188 Tests)
