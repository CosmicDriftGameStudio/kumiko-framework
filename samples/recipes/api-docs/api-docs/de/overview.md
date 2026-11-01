---
title: "HTTP-API"
description: "Endpunkte, Request-Body, Antworten, Fehlercodes, Listen und Batches der HTTP-API."
---

Jeder Aufruf ist ein POST mit JSON-Body. Das Feld `type` nennt den Handler, `payload` enthält dessen Felder. Die Referenzseiten listen jeden Handler mit seinen Feldern.

## Endpunkte

| Endpoint |  |
| --- | --- |
| `POST /api/query` | Liest Daten. Ändert nie etwas. |
| `POST /api/write` | Ändert Daten: anlegen, ändern, löschen oder eine bestimmte Aktion. |
| `POST /api/batch` | Führt mehrere Schreibaufrufe in einer Transaktion aus. |

## Authentifizierung

Sende einen API-Token im Header `Authorization` als `Bearer <token>`. Anfragen mit Token brauchen weder Cookie noch CSRF-Token. Der Token legt auch das Konto fest, in dem die Anfrage läuft. Du sendest also nie eine Konto- oder Mandanten-ID.

## Request-Body

`type` ist der Name des Handlers, zum Beispiel `ticketing:query:ticket:detail`. `payload` enthält die Felder aus der Referenz. `requestId` ist optional, siehe unten. Das Payload darf höchstens 20 Ebenen tief verschachtelt sein.

```bash
curl -X POST https://ticketing.example.com/api/query \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
  "type": "ticketing:query:ticket:detail",
  "payload": {
    "id": "00000000-0000-4000-8000-000000000001"
  }
}'
```

## Antworten

Ein erfolgreiches Lesen liefert `data`. Ein erfolgreiches Schreiben liefert `isSuccess: true` und `data`.

Bei einem Fehler ist der HTTP-Status 4xx oder 5xx und der Body enthält `error`. Schreibaufrufe liefern zusätzlich `isSuccess: false`. Werte `error.code` und den Status aus. `message` ist für Menschen gedacht und kann sich ändern.

## Fehlercodes

| Code | HTTP-Status | Bedeutung |
| --- | --- | --- |
| `ambiguous_auth` | 400 | Die Anfrage enthielt Session-Cookie und Token. Sende nur eines von beiden. |
| `validation_error` | 400 | Das Payload passt nicht zu den Feldern des Handlers. `details` nennt die Felder. |
| `invalid_token` | 401 | Der Token ist unbekannt, widerrufen oder abgelaufen. |
| `missing_token` | 401 | Der Header `Authorization` fehlt. |
| `unauthenticated` | 401 | Es wurden keine gültigen Zugangsdaten gesendet. |
| `access_denied` | 403 | Dem Token fehlt der Scope für diesen Handler, oder der Endpunkt nimmt keine Tokens an. |
| `feature_disabled` | 403 | Diese Funktion ist abgeschaltet oder nicht Teil deines Tarifs. |
| `not_found` | 404 | Der Datensatz existiert nicht oder du darfst ihn nicht sehen. |
| `conflict` | 409 | Die Änderung widerspricht dem aktuellen Stand der Daten. |
| `idempotent_replay` | 409 | Diese Änderung wurde unter demselben Idempotenz-Schlüssel schon ausgeführt. Der erste Versuch war erfolgreich, sende sie nicht noch einmal. |
| `precondition_failed` | 409 | Ein Feld des Datensatzes hat nicht mehr den Wert, den die Änderung erwartet hat. Lies den Datensatz neu und wiederhole. |
| `record_locked` | 409 | Eine andere Änderung sperrt den Datensatz. Wiederhole gleich. |
| `unique_violation` | 409 | Ein Datensatz mit diesem Wert existiert bereits. |
| `version_conflict` | 409 | Der Datensatz hat sich nach deinem Lesen geändert. Lies ihn neu und wiederhole mit der neuen `version`. |
| `unconfigured` | 422 | Eine Einstellung, die diese Funktion braucht, ist noch leer. Richte sie zuerst in der App ein und wiederhole dann. |
| `unprocessable` | 422 | Die Daten sind gültig, aber eine Fachregel lehnt die Änderung ab. `details.reason` nennt die Regel. |
| `pat_rate_limited` | 429 | Dieser Token hat in kurzer Zeit zu viele Anfragen gesendet. Warte einen Moment und wiederhole. |
| `rate_limited` | 429 | Zu viele Anfragen. Warte so viele Sekunden, wie der Header `Retry-After` angibt. |
| `internal_error` | 500 | Unerwarteter Serverfehler. Wiederhole später. |
| `rate_limit_unavailable` | 503 | Die Ratenbegrenzung ist vorübergehend nicht verfügbar, die Anfrage wurde abgelehnt. Wiederhole gleich. |
| `member_read_timeout` | 504 | Ein Lesevorgang auf dem Server hat zu lange gedauert und wurde abgebrochen. Wiederhole später. |

## Versionen und Konflikte

Jeder Datensatz hat eine `version`. Ein Update nimmt die `version`, die du zuletzt gelesen hast. Hat jemand den Datensatz zwischenzeitlich geändert, schlägt der Aufruf mit 409 `version_conflict` fehl. Lies den Datensatz neu, prüfe die Änderung und sende sie mit der neuen Version.

## Listen

Listen-Handler enden auf `:list` und akzeptieren diese Felder:

| Feld | Typ | Beschreibung |
| --- | --- | --- |
| `cursor` | string | Position aus `nextCursor` der vorherigen Seite. |
| `limit` | integer | Zeilen pro Seite, standardmäßig 50, höchstens 200. |
| `search` | string | Volltextsuche über die durchsuchbaren Felder. |
| `sort` | string | Feld, nach dem sortiert wird. |
| `sortDirection` | "asc" \| "desc" | `asc` oder `desc`. |
| `offset` | integer | Anzahl der zu überspringenden Zeilen. Nutze besser `cursor` zum Blättern. |
| `totalCount` | boolean | Mit `true` bekommst du zusätzlich `total`, die Anzahl der passenden Zeilen. |
| `includeDeleted` | boolean | Mit `true` sind gelöschte Zeilen enthalten. Nur für Entitäten mit Soft Delete. |
| `onlyDeleted` | boolean | Mit `true` kommen nur gelöschte Zeilen zurück. Nur für Entitäten mit Soft Delete, nicht zusammen mit `includeDeleted`. |
| `filter` | object | Ein Feldfilter mit `field`, `op` und `value`. `op` ist einer von `eq`, `ne`, `lt`, `gt`, `lte`, `gte`, `in`. |
| `filters` | array of object | Mehrere Feldfilter, je mit `field`, `op` und `value`. `op` ist einer von `eq`, `ne`, `lt`, `gt`, `lte`, `gte`, `in`. |
| `namedFilter` | string | Name eines vordefinierten Filters der Entität, zum Beispiel einer Arbeitsliste. |
| `aggregate` | object | Liefert aggregierte Werte statt Zeilen. |

Die Antwort enthält `rows` und `nextCursor`. Für die nächste Seite sendest du `nextCursor` als `cursor`. Auf der letzten Seite ist `nextCursor` `null`.

## Batches

`POST /api/batch` nimmt `commands`, eine Liste von Schreibaufrufen `{ type, payload }`. Sie laufen in einer Transaktion: Schlägt einer fehl, wirkt keiner. Die Antwort hat dann `isSuccess: false`, den `error` und `failedIndex`, die Position des fehlgeschlagenen Befehls ab 0 gezählt.

## Sicher wiederholen

Sende bei Schreib- und Batch-Aufrufen eine `requestId` mit. Das ist ein beliebiger String, der pro Änderung eindeutig ist. Reißt die Verbindung ab und du sendest denselben Aufruf mit derselben `requestId` erneut, bekommst du das erste Ergebnis zurück und die Änderung läuft nicht doppelt.
