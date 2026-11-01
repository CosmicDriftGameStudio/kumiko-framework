---
title: "Tickets"
description: "API reference for Tickets: every handler with its fields and an example."
---

### ticket: detail

**Show ticket**

Returns one ticket.

- Required scope: `tickets:read`
- Endpoint: `POST /api/query`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes | Ticket ID |

**Example request**

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

**Example response**

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

**List tickets**

Lists tickets, newest first.

- Required scope: `tickets:read`
- Endpoint: `POST /api/query`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `cursor` | string | no | Position from `nextCursor` of the previous page. |
| `limit` | integer | no | Rows per page, 50 by default, at most 200. |
| `search` | string | no | Full-text search across the searchable fields. |
| `sort` | string | no | Field to sort by. |
| `sortDirection` | "asc" \| "desc" | no | `asc` or `desc`. |
| `offset` | integer | no | Number of rows to skip. Prefer `cursor` for paging. |
| `totalCount` | boolean | no | Set `true` to also get `total`, the number of matching rows. |
| `includeDeleted` | boolean | no | Set `true` to include deleted rows. Only for entities with soft delete. |
| `onlyDeleted` | boolean | no | Set `true` to return only deleted rows. Only for entities with soft delete, not together with `includeDeleted`. |
| `filter` | object | no | One field filter with `field`, `op` and `value`. `op` is one of `eq`, `ne`, `lt`, `gt`, `lte`, `gte`, `in`. |
| `filter.field` | string | yes |  |
| `filter.op` | "eq" \| "ne" \| "lt" \| "gt" \| "lte" \| "gte" \| "in" | yes |  |
| `filter.value` | any | yes |  |
| `filters` | array of object | no | Several field filters, each with `field`, `op` and `value`. `op` is one of `eq`, `ne`, `lt`, `gt`, `lte`, `gte`, `in`. |
| `namedFilter` | string | no | Name of a predefined filter of the entity, for example a work queue. |
| `aggregate` | object | no | Returns aggregated values instead of rows. |
| `aggregate.groupBy` | string | no |  |
| `aggregate.measures` | array of object | no |  |

**Example request**

```bash
curl -X POST https://ticketing.example.com/api/query \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
  "type": "ticketing:query:ticket:list",
  "payload": {}
}'
```

**Example response**

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

**Close ticket**

Closes a ticket and records how it was resolved.

- Required scope: `tickets:write`
- Endpoint: `POST /api/write`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes | Ticket |
| `resolution` | string | yes | Resolution |

**Example request**

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

**Example response**

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

**Create ticket**

Opens a new ticket.

- Required scope: `tickets:write`
- Endpoint: `POST /api/write`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `title` | string | yes | Title |
| `status` | "open" \| "closed" | no | Status |
| `priority` | "low" \| "normal" \| "high" | no | Priority |

**Example request**

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

**Example response**

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

**Update ticket**

Changes the title or the priority of a ticket.

- Required scope: `tickets:write`
- Endpoint: `POST /api/write`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes | Ticket ID |
| `version` | number | yes |  |
| `changes` | object | yes |  |
| `changes.title` | string | no | Title |
| `changes.status` | "open" \| "closed" | no | Status |
| `changes.priority` | "low" \| "normal" \| "high" | no | Priority |

**Example request**

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

**Example response**

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
