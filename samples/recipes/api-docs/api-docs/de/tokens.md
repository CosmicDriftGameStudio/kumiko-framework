---
title: "API-Tokens"
description: "Lege einen API-Token für Helpdesk an, wähle seine Scopes und sende ihn mit deinen Anfragen."
---

Mit einem API-Token kann ein Skript oder ein anderer Dienst die API von Helpdesk in deinem Namen aufrufen. Seine Scopes bestimmen, welche Daten er lesen oder ändern darf.

## Token anlegen

1. Öffne Einstellungen › API-Tokens.
2. Wähle **Neuen Token erstellen**.
3. Gib einen Namen ein, wähle die Scopes und das Ablaufdatum und bestätige mit deinem Passwort.
4. Kopiere den Token. Er beginnt mit `kpat_` und wird nur einmal angezeigt.

Ein Token läuft nach 90 Tagen ab, wenn du keinen anderen Ablauf wählst. Möglich sind höchstens 3650 Tage.

## Token verwenden

Sende den Token im Header `Authorization`. Anfragen mit Token brauchen weder Cookie noch CSRF-Token.

```bash
curl -X POST https://helpdesk.example.com/api/query \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
  "type": "helpdesk:query:ticket:detail",
  "payload": {
    "id": "00000000-0000-4000-8000-000000000001"
  }
}'
```

## Scopes

Jeder Scope hat zwei Stufen. `read` erlaubt die lesenden Handler. `write` erlaubt alles, was `read` erlaubt, und zusätzlich die schreibenden Handler.

| Scope | Berechtigung | Handler |
| --- | --- | --- |
| `tickets` (Tickets) | `tickets:read` | `helpdesk:query:ticket:detail`, `helpdesk:query:ticket:list` |
| `tickets` (Tickets) | `tickets:write` | `helpdesk:write:ticket:close`, `helpdesk:write:ticket:create`, `helpdesk:write:ticket:update` |

## Ratenbegrenzung

Jeder Token darf 60 Anfragen pro 60 Sekunden senden. Darüber antwortet die API mit 429 `pat_rate_limited`.

API-Tokens sind in jedem Helpdesk-Tarif enthalten.

## Fehler

| HTTP-Status | Code | Ursache |
| --- | --- | --- |
| 401 | `missing_token` | Es fehlt der Header `Authorization`. |
| 401 | `invalid_token` | Der Token ist unbekannt, widerrufen oder abgelaufen. |
| 403 | `access_denied` | Dem Token fehlt der Scope für diesen Handler. |
| 403 | `access_denied` | Der Endpunkt nimmt keine Tokens an. Tokens funktionieren nur an den API-Endpunkten. |
| 429 | `pat_rate_limited` | Zu viele Anfragen mit diesem Token. |

## Token widerrufen

Widerrufe einen Token in Einstellungen › API-Tokens, sobald du ihn nicht mehr brauchst. Wenn du dein Passwort änderst, werden alle deine Tokens widerrufen. Ein Token handelt immer mit deinen aktuellen Rollen. Verlässt du das Konto oder wird dein Benutzer gelöscht, funktioniert er nicht mehr.

## Sicherheit

- Behandle einen Token wie ein Passwort. Bewahre ihn in einem Secret Store auf, nie im Code, in einem Repository, in einer App oder Webseite oder in einem Log.
- Gib jedem Skript einen eigenen Token mit nur den Scopes, die es braucht.
- Widerrufe Tokens, die du nicht mehr nutzt. Widerrufe einen Token sofort, wenn er in fremde Hände gelangt sein könnte.
