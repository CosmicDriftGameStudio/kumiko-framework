---
status: reference
verified: 2026-07-13
issue: 957
---

# Inbound-Mail: Data-Retention & PII-Subject-Entscheidung

Wie die `inbound-mail-foundation` Mail-Korrespondenz aufbewahrt und löscht,
und warum die tatsächliche PII-Löschung eine bewusste Grenze hat.

## Retention-Mechanismus

Ein `perTenant`-Cron (`inbound-mail-retention`, täglich 03:00) räumt zwei
Stores. Beide Fristen sind Konstanten (`retention-sweep.ts`), Default
365 Tage für Messages, 90 für Seen-Anker.

| Store | Mechanismus | Warum |
|---|---|---|
| `read_inbound_messages` (event-sourced) | pro Row `receivedAt < cutoff`: `archiveStream` + Row-Delete + `bodyRef`-Objekt löschen | rebuild-safe, siehe unten |
| `store_mail_seen_messages` (unmanaged) | `deleteMany` auf `seenAt < cutoff`, tenant-scoped | Dedup-Anker braucht nur das Replay-Fenster |
| `store_mail_sync_cursors` | bleibt | eine Row pro Account, kein Wachstum |

### Warum `archiveStream`, nicht `executor.forget`

Die naheliegende Wahl wäre `executor.forget` (das generische
`data-retention`-Feature nutzt es). Für `inbound-message` **resurrectet** das
aber beim Rebuild: der Stream hat eine **explizite** `r.projection`, deren
apply-Map nur das `received`-Domain-Event kennt. Den `forgotten`-Auto-Verb
registriert ausschließlich die `ImplicitProjection` — bei einer expliziten
Projection wird er ignoriert, der Rebuild replayt nur `received` und legt die
Row neu an (die #648-Klasse). `forget` ist deshalb nur rebuild-safe für
implizite Projektionen; der generische Runner filtert genau darum auf
`isImplicit === true`.

`archiveStream` macht den Stream read-only → `loadAggregate` liefert leer →
der Rebuild replayt `received` gar nicht erst. Gleiches Muster wie der
`tenant-destroy-hook` für dieselbe Entity, nur per-Row-cutoff statt ganzer
Tenant.

## PII-Subject-Entscheidung (V1) & Erasure-Grenze

Die tenantOwned-Felder (`from`/`to`/`cc`/`subject`/`snippet`) sind unter dem
**Tenant**-Subject-Key envelope-verschlüsselt. Daraus folgt eine bewusste
Grenze der per-Message-Retention:

- **Was der Sweep löscht:** die Read-Row und das Body-File. Das
  Datenminimierungs-Ziel (Art. 5) für die unbegrenzt wachsenden Read-Models +
  File-Bodies ist damit erfüllt.
- **Was bleibt:** die verschlüsselte PII in den `*.received`-**Events** im
  Event-Log. Echte kryptografische Löschung (Art. 17) passiert über
  Key-Shredding — und der Tenant-Key wird per-Message **nicht** erased (der
  Tenant lebt weiter). Die Event-Payloads bleiben also unter dem Tenant-Key
  entschlüsselbar bis zum **Tenant-Destroy** (dort shreddet
  `eraseSubjectKeys` den Key). Das Event-Log ist append-only by design.

### Vertagt: per-Sender-Keys

Ein absenderbezogener Forget-Flow (externer Absender verlangt Löschung nur
seiner Mails) bräuchte **per-Sender-Subject-Keys** statt des Tenant-Keys —
dann würde ein Sender-Key-Erase genau dessen Message-Events unlesbar machen.
Für die aktuellen Compliance-Profile und den Single-Tenant-Betrieb ist das
nicht nötig; die per-Message-Retention + Tenant-Destroy-Erasure decken die
realen Anforderungen. Bei Bedarf (z.B. `de-hr-dsgvo-hgb` mit externem
Sender-Erasure-Anspruch) ist der Umstieg auf per-Sender-Keys der Pfad.

## Bekannte Decke

Wird eine bereits gepurgte Message > Retention-Frist erneut zugestellt, trifft
der Ingest einen archivierten Stream → `appendEvent` wirft. Für eine
Redelivery > 365 Tage nach Erstempfang extrem unwahrscheinlich; das Werfen ist
das korrekte Verhalten (der Stream ist bewusst versiegelt), nicht ein Bug.

## Nicht umgesetzt (Teil 3, bewusst)

Ein Boot-Validator „tenant-subject-PII-Entity ohne Retention-Policy → Warnung"
(analog `gdpr-storage`) wurde erwogen und **vertagt**: er würde eine
allgemeine Konvention über alle Features erzwingen (retention-Annotation vs.
dedizierter Sweep), die es noch nicht gibt. Solange inbound-mail das einzige
Feature mit dediziertem Retention-Sweep ist, wäre der Validator eine
Ein-Ort-Regel ohne zweiten Anwendungsfall.
