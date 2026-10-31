---
status: in-progress
verified: 2026-10-31
issue: kumiko-framework#4165
next: "#4166 und #4167 im PR feat/tenant-inactivity, danach Opt-in in kumiko-studio#523"
---

# Inaktive Konten: Vorwarnungen und ein Weg ins Löschen

## Problem und Kontext

Free-Konten, die niemand mehr nutzt, bleiben heute für immer bestehen. Im Studio laufen ihre Apps weiter und belegen Datenbank, Redis und Speicher. Das Framework kennt keinen Begriff von Inaktivität und schickt vor keiner Löschung eine Erinnerung.

Bausteine, die es schon gibt:

- **Kontolöschung mit Wartefrist** (`tenant-lifecycle`): `request-destruction.write.ts` setzt `gracePeriodEnd` aus `profile.tenantDestroyGracePeriod` (30 oder 60 Tage, `framework/src/compliance/profiles.ts`), sperrt das Konto (410 über `lifecycle-gate.ts`) und beendet die Sitzungen. `cancel-destruction.write.ts` bricht innerhalb der Frist ab. Danach baut `run-tenant-destroy.ts` in Stufen ab (`stages.ts`).
- **Aufbewahrung** (`data-retention`): `blockDelete` hält Zeilen während `keepFor` fest (`run-retention-cleanup.ts`). Die DSGVO-Löschung je Nutzer (`user-data-rights/run-forget-cleanup.ts`) beachtet das und anonymisiert dann statt zu löschen.
- **Letzte Aktivität je Sitzung**: `sessions/session-callbacks.ts` schreibt `lastSeenAt` höchstens einmal pro Stunde (`LAST_SEEN_REFRESH_MS`).

Lücken:

1. `tenant-lifecycle` liest `blockDelete` nirgends. Der Abbau löscht also auch Daten mit laufender Aufbewahrungsfrist.
2. Es gibt keine dauerhafte letzte Aktivität je Konto. `lastSeenAt` hängt an der Sitzung, und Sitzungen werden nach Ablauf gelöscht.
3. Es gibt keinen Inaktivitäts-Ablauf und keine Vorwarnmails.

## Ziel

1. Das Framework speichert je Konto die letzte Aktivität.
2. Ist ein Konto zu lange inaktiv, gehen zwei Vorwarnmails raus. Jede Aktivität und ein Klick auf „Konto behalten“ setzen den Zähler zurück.
3. Danach stellt das System den normalen Löschantrag. Ab dann gilt die vorhandene Wartefrist: Das Konto ist gesperrt, kann aber wiederhergestellt werden.
4. Am Ende kommt der normale Abbau. Daten mit laufender Aufbewahrungsfrist bleiben gesperrt bis Fristende.

**Nicht-Ziele:** keine Inaktivität je einzelnem Nutzer innerhalb eines Kontos, keine Abo-Erinnerungen (Kartenablauf, Trial-Ende), keine neue Lösch-Wartefrist neben `tenantDestroyGracePeriod`.

## Entscheidungen (freigegeben am 2026-10-31)

| Punkt | Entscheidung |
| --- | --- |
| Was als Aktivität zählt | Nur angemeldete Nutzer, in jeder App, die das Framework fährt (im Studio also Studio und veröffentlichte Apps). Anonyme Aufrufe und Bots zählen nicht. |
| Schreibrate | Höchstens ein Write je Konto und Stunde, gespeist vom `lastSeenAt`-Refresh. |
| Inaktiv ab | Free: 12 Monate ohne Aktivität. Wert je Tarif konfigurierbar. |
| Vorwarnungen | 30 und 7 Tage vor dem Löschantrag, an die Konto-Inhaber. |
| Bezahlte Konten | Keine Inaktivität, solange das Abo läuft. Endet das Abo, wird das Konto Free und die Free-Regel beginnt ab dann. |
| Nach der letzten Warnung | Automatischer Löschantrag über `tenant-lifecycle`, mit der Wartefrist des Compliance-Profils. |
| Aufbewahrung | Der Abbau löscht keine Zeilen mit laufender `blockDelete`-Frist. Sie bleiben gesperrt bis Fristende und werden dann vom Retention-Lauf entfernt; der Konto-Datensatz fällt erst danach. |
| Geltung | Für alle Apps per Opt-in. Ohne Opt-in ändert sich nichts. |

Zeitachse Free: 11 Monate erste Mail, 11 Monate und 23 Tage zweite Mail, 12 Monate Löschantrag, plus 30 Tage Wartefrist bis zum Abbau.

## Schnitt

- #4166: Abbau beachtet Aufbewahrung.
- #4167: Aktivität je Konto und Feature `tenant-inactivity` mit Vorwarnmails, dazu ein Extension-Point für fremde Aktivitätsquellen, den der Cron vor jeder Warnung fragt. Darüber zählt das Studio die Nutzung der veröffentlichten Apps.
- kumiko-studio#523: Opt-in mit Tarifwerten.
- Weitere Apps: Opt-in nach dem FW-Release über das normale Bump-Issue je Repo.

## Umsetzung

- **Gehaltene Zeilen beim Abbau:** Die Stufe `app-data` überspringt den Destroy-Hook einer Entity, solange sie für das Konto `blockDelete`-Zeilen innerhalb `keepFor` hat, und anonymisiert deren personenbezogene Felder. Vor `tenant-row` geht das Konto in den Status `destroyHeld` (gesperrt wie die übrigen Abbau-Status), statt eine Stufe zu verbrauchen. Der Retention-Lauf entfernt abgelaufene Zeilen eines gehaltenen Kontos endgültig; ein täglicher Lauf in `tenant-lifecycle` setzt das Konto zurück auf `destroying`, sobald nichts mehr gehalten ist, und der Abbau schließt mit `tenant-row` ab.
- **Dateien gehaltener Zeilen:** Die Stufe `files` überspringt Dateien, auf die eine gehaltene Zeile zeigt. Der Retention-Lauf entfernt sie zusammen mit der Zeile.
- **Aktivität (Entscheidung vom 2026-10-31, weicht von „an derselben Stelle wie der Refresh“ ab):** Der Session-Refresh schreibt nichts Neues. Der tägliche Lauf von `tenant-inactivity` übernimmt die jüngste `lastSeenAt` der Sitzungen je Konto in die eigene Zustandstabelle. `lastActivityAt` wird dabei nur hochgezogen, nie zurückgesetzt. Entfernt der Session-Cleanup alte Zeilen, bleibt der zuletzt übernommene Wert stehen. Grund: Der Session-Store kennt die Registry nicht. Ein Write im Refresh würde also auch Apps ohne das Feature ändern. Die freigegebene Semantik bleibt: nur angemeldete Nutzer, dauerhaft je Konto, höchstens ein Write je Konto und Lauf.
- **Erster Lauf:** Ein Konto, das das Feature zum ersten Mal sieht, beginnt seine Frist bei diesem Lauf. Ein nachträgliches Opt-in löscht also nichts früher als zwölf Monate danach.
