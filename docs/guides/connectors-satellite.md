---
status: reference
verified: 2026-11-19
evidence: "packages/bundled-features/src/connectors/routes.ts, device-auth.ts, hash.ts, handlers/device-poll.write.ts, handlers/receive-file.write.ts, __tests__/device-flow.integration.test.ts, __tests__/upload.integration.test.ts"
---

# Connectors: a satellite delivers files into the app

`createConnectorsFeature()` lets a program on a customer's own machine (the satellite) pair with the app and deliver files. This guide is the wire protocol for the satellite's author. Mount the endpoints with `createConnectorRoutes()` as `extraRoutes`; they live outside `/api`, so the satellite needs no session.

All paths below are relative to the mount point (default `/connectors`).

## Pairing (OAuth device flow, RFC 8628)

The satellite uses the fixed client id `kumiko-satellite`. It may send it as a form field or as the user of an HTTP Basic header. Another client id is answered with HTTP 401 `{"error":"invalid_client"}`.

1. `POST /v1/device_authorization` with `client_id=kumiko-satellite` returns
   `{device_code, user_code, verification_uri, expires_in, interval}`. The user code looks like `AB12-CD34` and is valid for 600 seconds; `interval` is 5 seconds. Show `user_code` and `verification_uri` to the person at the machine.
2. A TenantAdmin of the tenant opens the pairing screen (`connector-pair`), enters the code and presses Check; on the confirm step (`connector-confirm`) the admin sees when and from which IP the request came, names the connector and confirms. Codes are read leniently: case, dashes and spaces are ignored and I and L count as 1, O as 0. Confirming works only for a code the same admin checked in the last 5 minutes, because a link can prefill the confirm screen with a code an attacker's satellite shows (RFC 8628 section 5.4); without that check the admin would confirm a stranger's device without ever comparing the request.
3. The satellite polls `POST /v1/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`, `device_code` and `client_id`, no faster than `interval` seconds.

Token endpoint answers, all as HTTP 400 `{"error": ...}` except success:

| Answer | Meaning |
| --- | --- |
| `authorization_pending` | not confirmed yet, keep polling |
| `slow_down` | polled too fast, add 5 seconds to the interval |
| `expired_token` | the 600 seconds are over, or nobody confirmed the code (a confirmation in the last moments stays collectable for 600 more seconds); start again. There is no "reject": a code belongs to no tenant before it is confirmed, so an admin of another tenant could end your pairing attempt |
| `invalid_grant` | unknown device code, or the token was already collected |
| `unsupported_grant_type` | wrong `grant_type` |

Success is HTTP 200 `{"access_token":"ksat_...","token_type":"Bearer"}`. There is no `expires_in` and no refresh token: the token stays valid until the admin revokes the connector. It is handed out exactly once; the app keeps only its SHA-256. Every response of the two pairing endpoints carries `Cache-Control: no-store`.

## Uploading a file

`POST /v1/files` with `Authorization: Bearer ksat_...` and the raw file bytes as the body.

| Header | Content |
| --- | --- |
| `X-Kumiko-Path` | path below the watched folder, percent-encoded UTF-8; `\` is read as `/` |
| `X-Kumiko-Sha256` | lower-case hex SHA-256 of the body |
| `X-Kumiko-Mtime` | modification time as an ISO 8601 instant, e.g. `2026-11-18T08:30:00Z` |
| `Content-Type` | the file's type; default `application/octet-stream` |

Answers:

- `201 {"id", "duplicate": false}`: stored as a new item.
- `200 {"id", "duplicate": true}`: the same connector, hash and path were delivered before. Retry after a lost response freely.
- `400 invalid_request`: header missing or malformed, a path with `..`, an absolute path or a drive letter, or a body that does not match the hash.
- `401 invalid_token`: unknown, malformed or revoked token. Stop and pair again.
- `403 connector_revoked`, `413` (over the per-file cap, 50 MiB by default), `422 file_rejected` (the file store refused the type or size).

The same bytes under another path are another item.

## Heartbeat

`POST /v1/heartbeat` with the bearer token and the JSON body `{"version": "1.4.2"}` (1 to 64 characters). Answer `200 {"ok":true}`. The connector list shows the version and the last time the device was seen; any upload counts as being seen too.

## Revoking

A TenantAdmin revokes a connector with `connectors:write:revoke`. Its token stops working at once (`401 invalid_token`), already delivered files stay.

## Admin screens

The feature ships three TenantAdmin screens: `connector-list` (connectors with status, last seen and version, a revoke action), `connector-pair` (enter the code; a code with no open request shows a hint) and `connector-confirm` (reached through the pair screen: request time and IP, a name, Confirm). All three are `dormant`: place the list in your admin area with one `r.nav({ id: "connectors", label, screen: "connectors:screen:connector-list", parent })`.

Without `verificationUri`, the satellite is shown `<origin>/connector-pair`, where origin is the origin of `APP_BASE_URL` if set, else the address the satellite reached. That is the screen's URL only in an app without workspaces or a base path; otherwise pass the full screen URL as `verificationUri`. There is no `verification_uri_complete`: the admin types the code on the pair screen.
