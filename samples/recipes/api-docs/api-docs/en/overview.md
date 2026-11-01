---
title: "HTTP API"
description: "Endpoints, request body, responses, error codes, lists and batches of the HTTP API."
---

Every call is a POST with a JSON body. The `type` field names the handler, `payload` carries its fields. The reference pages list every handler with its fields.

## Endpoints

| Endpoint |  |
| --- | --- |
| `POST /api/query` | Reads data. Never changes anything. |
| `POST /api/write` | Changes data: create, update, delete or a specific action. |
| `POST /api/batch` | Runs several write calls in one transaction. |

## Authentication

Send an API token in the `Authorization` header as `Bearer <token>`. Requests with a token need no cookie and no CSRF token. The token also fixes the account the request runs in, so you never send an account or tenant ID.

## Request body

`type` is the handler name, for example `helpdesk:query:ticket:detail`. `payload` holds the fields from the reference. `requestId` is optional, see below. The payload may be nested at most 20 levels deep.

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

## Responses

A successful read returns `data`. A successful write returns `isSuccess: true` and `data`.

On failure the HTTP status is 4xx or 5xx and the body contains `error`. Write calls also return `isSuccess: false`. Branch on `error.code` and the status. `message` is meant for people and may change.

## Error codes

| Code | HTTP status | Meaning |
| --- | --- | --- |
| `ambiguous_auth` | 400 | The request carried both a session cookie and a token. Send only one. |
| `validation_error` | 400 | The payload does not match the handler's fields. `details` names the fields. |
| `invalid_token` | 401 | The token is unknown, revoked or expired. |
| `missing_token` | 401 | The `Authorization` header is missing. |
| `unauthenticated` | 401 | No valid credentials were sent. |
| `access_denied` | 403 | The token lacks the scope for this handler, or the endpoint does not accept tokens. |
| `feature_disabled` | 403 | This function is switched off or not part of your plan. |
| `not_found` | 404 | The record does not exist or you cannot see it. |
| `conflict` | 409 | The change conflicts with the current state of the data. |
| `idempotent_replay` | 409 | This change was already applied under the same idempotency key. The first attempt succeeded, so do not send it again. |
| `precondition_failed` | 409 | A field of the record no longer has the value the change expected. Read the record again and retry. |
| `record_locked` | 409 | Another change holds a lock on the record. Retry shortly. |
| `unique_violation` | 409 | A record with this value already exists. |
| `version_conflict` | 409 | The record changed after you read it. Read it again and retry with the new `version`. |
| `unconfigured` | 422 | A setting this function needs is still empty. Set it up in the app first, then retry. |
| `unprocessable` | 422 | The data is valid, but a business rule rejects the change. `details.reason` names the rule. |
| `pat_rate_limited` | 429 | This token sent too many requests in a short time. Wait a moment and retry. |
| `rate_limited` | 429 | Too many requests. Wait as many seconds as the `Retry-After` header says. |
| `internal_error` | 500 | Unexpected server error. Retry later. |
| `rate_limit_unavailable` | 503 | The rate limiter is temporarily unavailable, so the request was refused. Retry shortly. |
| `member_read_timeout` | 504 | A read on the server took too long and was stopped. Retry later. |

## Versions and conflicts

Every record has a `version`. An update takes the `version` you read last. If someone changed the record in between, the call fails with 409 `version_conflict`. Read the record again, check the change and send it with the new version.

## Lists

List handlers end in `:list` and accept these fields:

| Field | Type | Description |
| --- | --- | --- |
| `cursor` | string | Position from `nextCursor` of the previous page. |
| `limit` | integer | Rows per page, 50 by default, at most 200. |
| `search` | string | Full-text search across the searchable fields. |
| `sort` | string | Field to sort by. |
| `sortDirection` | "asc" \| "desc" | `asc` or `desc`. |
| `offset` | integer | Number of rows to skip. Prefer `cursor` for paging. |
| `totalCount` | boolean | Set `true` to also get `total`, the number of matching rows. |
| `includeDeleted` | boolean | Set `true` to include deleted rows. Only for entities with soft delete. |
| `onlyDeleted` | boolean | Set `true` to return only deleted rows. Only for entities with soft delete, not together with `includeDeleted`. |
| `filter` | object | One field filter with `field`, `op` and `value`. `op` is one of `eq`, `ne`, `lt`, `gt`, `lte`, `gte`, `in`. |
| `filters` | array of object | Several field filters, each with `field`, `op` and `value`. `op` is one of `eq`, `ne`, `lt`, `gt`, `lte`, `gte`, `in`. |
| `namedFilter` | string | Name of a predefined filter of the entity, for example a work queue. |
| `aggregate` | object | Returns aggregated values instead of rows. |

The response contains `rows` and `nextCursor`. For the next page send `nextCursor` as `cursor`. On the last page `nextCursor` is `null`.

## Batches

`POST /api/batch` takes `commands`, a list of `{ type, payload }` write calls. They run in one transaction: if one fails, none takes effect. The response then has `isSuccess: false`, the `error` and `failedIndex`, the position of the failed command counted from 0.

## Safe retries

Send a `requestId` with write and batch calls, any string that is unique per change. If the connection drops and you send the same call again with the same `requestId`, you get the first result back and the change does not run twice.
