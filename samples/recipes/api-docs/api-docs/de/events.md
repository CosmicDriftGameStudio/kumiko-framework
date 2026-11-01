---
title: "Webhook-Ereignisse"
description: "Webhook-Ereignisse: wann sie ausgelöst werden, welchen Scope sie brauchen und was ihre Nutzlast enthält."
---

Ein Webhook-Ereignis meldet deinem System, dass sich etwas geändert hat. Jedes Ereignis hat einen Namen, eine Version und eine Nutzlast. Der bei einem Ereignis genannte Scope ist der Token-Scope, der das Abonnieren erlaubt.

## Zustellung

Zustellungen sind signiert, damit du den Absender prüfen kannst. Eine fehlgeschlagene Zustellung wird einige Male wiederholt, bevor sie verworfen wird. Antworte innerhalb weniger Sekunden und behandle wiederholte Zustellungen desselben Ereignisses als eine.

## Versionen

Ein neues optionales Feld behält die Version. Eine inkompatible Änderung, etwa ein entferntes oder umbenanntes Feld oder ein geänderter Typ, bekommt eine neue Version.

## Ereignisse

### helpdesk:ticket-closed

Ein Ticket wurde geschlossen und seine Lösung festgehalten.

- Version: `1`
- Benötigter Scope: `tickets:read`

| Feld | Typ | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `id` | string (uuid) | ja | ID des geschlossenen Tickets |
| `resolution` | string | ja | Wie das Ticket gelöst wurde |

**Beispiel-Nutzlast**

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "resolution": "Replaced the roller"
}
```

### ticket.created

Ein Datensatz vom Typ Ticket wurde angelegt.

- Version: `1`
- Benötigter Scope: `tickets:read`

| Feld | Typ | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `id` | string (uuid) | ja | Ticket-ID |
| `title` | string | ja | Titel |
| `status` | "open" \| "closed" | ja | Status |
| `priority` | "low" \| "normal" \| "high" | ja | Priorität |

**Beispiel-Nutzlast**

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "title": "Scanner jams",
  "status": "open",
  "priority": "low"
}
```
