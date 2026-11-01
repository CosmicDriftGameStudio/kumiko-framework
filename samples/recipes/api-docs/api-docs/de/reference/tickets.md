---
title: "Tickets"
description: "API-Referenz für Tickets: jeder Handler mit seinen Feldern und einem Beispiel."
---

### ticket: detail

**Ticket anzeigen**

Liefert ein Ticket.

- Benötigter Scope: `tickets:read`
- Endpunkt: `POST /api/query`

| Feld | Typ | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `id` | string (uuid) | ja | Ticket-ID |

**Beispielanfrage**

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

**Beispielantwort**

Status: 200

```json
{
  "data": {
    "id": "00000000-0000-4000-8000-000000000001",
    "tenantId": "00000000-0000-4000-8000-000000000002",
    "version": 1,
    "insertedAt": "2026-01-15T09:30:00.000Z",
    "modifiedAt": null,
    "insertedById": "00000000-0000-4000-8000-000000000003",
    "modifiedById": null,
    "title": "Printer is on fire",
    "status": "open",
    "priority": "high"
  }
}
```

### ticket: list

**Tickets auflisten**

Listet Tickets, neueste zuerst.

- Benötigter Scope: `tickets:read`
- Endpunkt: `POST /api/query`

| Feld | Typ | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `cursor` | string | nein | Position aus `nextCursor` der vorherigen Seite. |
| `limit` | integer | nein | Zeilen pro Seite, standardmäßig 50, höchstens 200. |
| `search` | string | nein | Volltextsuche über die durchsuchbaren Felder. |
| `sort` | string | nein | Feld, nach dem sortiert wird. |
| `sortDirection` | "asc" \| "desc" | nein | `asc` oder `desc`. |
| `offset` | integer | nein | Anzahl der zu überspringenden Zeilen. Nutze besser `cursor` zum Blättern. |
| `totalCount` | boolean | nein | Mit `true` bekommst du zusätzlich `total`, die Anzahl der passenden Zeilen. |
| `includeDeleted` | boolean | nein | Mit `true` sind gelöschte Zeilen enthalten. Nur für Entitäten mit Soft Delete. |
| `onlyDeleted` | boolean | nein | Mit `true` kommen nur gelöschte Zeilen zurück. Nur für Entitäten mit Soft Delete, nicht zusammen mit `includeDeleted`. |
| `filter` | object | nein | Ein Feldfilter mit `field`, `op` und `value`. `op` ist einer von `eq`, `ne`, `lt`, `gt`, `lte`, `gte`, `in`. |
| `filter.field` | string | ja |  |
| `filter.op` | "eq" \| "ne" \| "lt" \| "gt" \| "lte" \| "gte" \| "in" | ja |  |
| `filter.value` | any | ja |  |
| `filters` | array of object | nein | Mehrere Feldfilter, je mit `field`, `op` und `value`. `op` ist einer von `eq`, `ne`, `lt`, `gt`, `lte`, `gte`, `in`. |
| `namedFilter` | string | nein | Name eines vordefinierten Filters der Entität, zum Beispiel einer Arbeitsliste. |
| `aggregate` | object | nein | Liefert aggregierte Werte statt Zeilen. |
| `aggregate.groupBy` | string | nein |  |
| `aggregate.measures` | array of object | nein |  |

**Beispielanfrage**

```bash
curl -X POST https://ticketing.example.com/api/query \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
  "type": "ticketing:query:ticket:list",
  "payload": {}
}'
```

**Beispielantwort**

Status: 200

```json
{
  "data": {
    "rows": [
      {
        "id": "00000000-0000-4000-8000-000000000001",
        "tenantId": "00000000-0000-4000-8000-000000000002",
        "version": 1,
        "insertedAt": "2026-01-15T09:30:00.000Z",
        "modifiedAt": null,
        "insertedById": "00000000-0000-4000-8000-000000000003",
        "modifiedById": null,
        "title": "Printer is on fire",
        "status": "open",
        "priority": "high"
      }
    ],
    "nextCursor": null
  }
}
```

### ticket: close

**Ticket schließen**

Schließt ein Ticket und hält fest, wie es gelöst wurde.

- Benötigter Scope: `tickets:write`
- Endpunkt: `POST /api/write`

| Feld | Typ | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `id` | string (uuid) | ja | Ticket |
| `resolution` | string | ja | Lösung |

**Beispielanfrage**

```bash
curl -X POST https://ticketing.example.com/api/write \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
  "type": "ticketing:write:ticket:close",
  "payload": {
    "id": "00000000-0000-4000-8000-000000000001",
    "resolution": "Replaced the cartridge"
  }
}'
```

**Beispielantwort**

Status: 200

```json
{
  "isSuccess": true,
  "data": {
    "id": "00000000-0000-4000-8000-000000000001"
  }
}
```

### ticket: create

**Ticket anlegen**

Legt ein neues Ticket an.

- Benötigter Scope: `tickets:write`
- Endpunkt: `POST /api/write`

| Feld | Typ | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `title` | string | ja | Titel |
| `status` | "open" \| "closed" | nein | Status |
| `priority` | "low" \| "normal" \| "high" | nein | Priorität |

**Beispielanfrage**

```bash
curl -X POST https://ticketing.example.com/api/write \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
  "type": "ticketing:write:ticket:create",
  "payload": {
    "title": "Printer is on fire",
    "priority": "high"
  }
}'
```

**Beispielantwort**

Status: 200

```json
{
  "isSuccess": true,
  "data": {
    "kind": "save",
    "id": "00000000-0000-4000-8000-000000000001",
    "data": {
      "id": "00000000-0000-4000-8000-000000000001",
      "tenantId": "00000000-0000-4000-8000-000000000002",
      "version": 1,
      "insertedAt": "2026-01-15T09:30:00.000Z",
      "modifiedAt": null,
      "insertedById": "00000000-0000-4000-8000-000000000003",
      "modifiedById": null,
      "title": "Printer is on fire",
      "status": "open",
      "priority": "high"
    },
    "changes": {
      "title": "Printer is on fire",
      "status": "open",
      "priority": "high"
    },
    "previous": {},
    "isNew": true,
    "entityName": "ticket"
  }
}
```

### ticket: update

**Ticket ändern**

Ändert Titel oder Priorität eines Tickets.

- Benötigter Scope: `tickets:write`
- Endpunkt: `POST /api/write`

| Feld | Typ | Pflicht | Beschreibung |
| --- | --- | --- | --- |
| `id` | string (uuid) | ja | Ticket-ID |
| `version` | number | ja |  |
| `changes` | object | ja |  |
| `changes.title` | string | nein | Titel |
| `changes.status` | "open" \| "closed" | nein | Status |
| `changes.priority` | "low" \| "normal" \| "high" | nein | Priorität |

**Beispielanfrage**

```bash
curl -X POST https://ticketing.example.com/api/write \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
  "type": "ticketing:write:ticket:update",
  "payload": {
    "id": "00000000-0000-4000-8000-000000000001",
    "version": 1,
    "changes": {
      "priority": "normal"
    }
  }
}'
```

**Beispielantwort**

Status: 200

```json
{
  "isSuccess": true,
  "data": {
    "kind": "save",
    "id": "00000000-0000-4000-8000-000000000001",
    "data": {
      "id": "00000000-0000-4000-8000-000000000001",
      "tenantId": "00000000-0000-4000-8000-000000000002",
      "version": 2,
      "insertedAt": "2026-01-15T09:30:00.000Z",
      "modifiedAt": "2026-01-15T09:30:00.000Z",
      "insertedById": "00000000-0000-4000-8000-000000000003",
      "modifiedById": "00000000-0000-4000-8000-000000000003",
      "title": "Printer is on fire",
      "status": "open",
      "priority": "normal"
    },
    "changes": {
      "priority": "normal"
    },
    "previous": {
      "id": "00000000-0000-4000-8000-000000000001",
      "tenantId": "00000000-0000-4000-8000-000000000002",
      "version": 1,
      "insertedAt": "2026-01-15T09:30:00.000Z",
      "modifiedAt": null,
      "insertedById": "00000000-0000-4000-8000-000000000003",
      "modifiedById": null,
      "title": "Printer is on fire",
      "status": "open",
      "priority": "high"
    },
    "isNew": false,
    "entityName": "ticket"
  }
}
```
