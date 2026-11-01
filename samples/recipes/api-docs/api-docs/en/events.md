---
title: "Webhook events"
description: "Webhook events: when they fire, which scope they need and what their payload contains."
---

A webhook event tells your system that something changed. Every event has a name, a version and a payload. The scope listed for an event is the token scope that allows subscribing to it.

## Delivery

Deliveries are signed so that you can verify the sender. A delivery that fails is retried a few times before it is dropped. Answer within a few seconds and treat repeated deliveries of the same event as one.

## Versions

Adding an optional field keeps the version. A breaking change, such as removing or renaming a field or changing its type, gets a new version.

## Events

### helpdesk:ticket-closed

A ticket was closed and its resolution recorded.

- Version: `1`
- Required scope: `tickets:read`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes | ID of the closed ticket |
| `resolution` | string | yes | How the ticket was resolved |

**Example payload**

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "resolution": "Replaced the roller"
}
```

### ticket.created

A record of type ticket was created.

- Version: `1`
- Required scope: `tickets:read`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes | Ticket ID |
| `title` | string | yes | Title |
| `status` | "open" \| "closed" | yes | Status |
| `priority` | "low" \| "normal" \| "high" | yes | Priority |

**Example payload**

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "title": "Scanner jams",
  "status": "open",
  "priority": "low"
}
```
