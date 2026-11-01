---
title: "API tokens"
description: "Create an API token for Helpdesk, choose its scopes and send it with your requests."
---

An API token lets a script or another service call the Helpdesk API in your name. Its scopes decide which data it may read or change.

## Create a token

1. Open Settings › API tokens.
2. Choose **Create a new token**.
3. Enter a name, pick the scopes and the expiry, and confirm with your password.
4. Copy the token. It starts with `kpat_` and is shown only once.

A token expires after 90 days unless you pick another expiry. The longest possible expiry is 3650 days.

## Use the token

Send the token in the `Authorization` header. Requests with a token need no cookie and no CSRF token.

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

Each scope comes in two levels. `read` allows the read handlers. `write` allows everything `read` allows plus the write handlers.

| Scope | Grant | Handlers |
| --- | --- | --- |
| `tickets` (Tickets) | `tickets:read` | `helpdesk:query:ticket:detail`, `helpdesk:query:ticket:list` |
| `tickets` (Tickets) | `tickets:write` | `helpdesk:write:ticket:close`, `helpdesk:write:ticket:create`, `helpdesk:write:ticket:update` |

## Rate limit

Each token may send 60 requests per 60 seconds. Above that the API answers 429 `pat_rate_limited`.

API tokens are included in every Helpdesk plan.

## Errors

| HTTP status | Code | Cause |
| --- | --- | --- |
| 401 | `missing_token` | No `Authorization` header. |
| 401 | `invalid_token` | The token is unknown, revoked or expired. |
| 403 | `access_denied` | The token lacks the scope for this handler. |
| 403 | `access_denied` | The endpoint does not accept tokens. Tokens work only on the API endpoints. |
| 429 | `pat_rate_limited` | Too many requests from this token. |

## Revoke a token

Revoke a token in Settings › API tokens as soon as you stop using it. Changing your password revokes all your tokens. A token always acts with your current roles. If you leave the account or your user is deleted, it stops working.

## Security

- Treat a token like a password. Keep it in a secret store, not in code or in a repository.
- Give each script its own token with only the scopes it needs.
- Revoke tokens you no longer use.
