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
   `{device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval}`. The user code looks like `AB12-CD34` and is valid for 600 seconds; `interval` is 5 seconds. Show `user_code` and `verification_uri` to the person at the machine, or offer `verification_uri_complete` (the same address with `?userCode=<code>`, RFC 8628 section 3.3.1) as a button: it only prefills the code on the pair screen, the admin still presses Check, and confirming stays bound to that Check by the same admin within 5 minutes.
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

## Protection against floods

The client id is public, so the pairing start has three limits; beyond the two open-request limits the endpoint answers HTTP 429 `{"error":"slow_down"}` with `Retry-After: 60` and stores nothing. The per-minute limit answers 429 as well. Every 429 from `/v1/device_authorization` carries `Retry-After` (seconds): wait that long before starting again, do not retry at once.

- At most 10 starts per minute and address (rate limit of `/v1/device_authorization`).
- At most 3 open (pending, not yet expired) requests per address; a confirmed or expired request frees its place.
- At most 1000 open requests overall, so many addresses together cannot fill the table.

An IPv6 address counts as its /64 prefix (an IPv4-mapped one as the IPv4 address), because one subscriber holds a whole /64 and could otherwise take a fresh address per request. The confirm screen therefore shows that prefix for IPv6 satellites. A request row is deleted as soon as its token is collected.

Override them with the route option `pairingLimits: { startsPerMinute, maxOpenPerIp, maxOpenTotal }`.

The address is the socket peer unless `KUMIKO_TRUSTED_PROXY_HOPS` is set, so a client cannot spoof it through `X-Forwarded-For`. Behind a reverse proxy set that value; otherwise every satellite shares the proxy address and the per-address limits apply to all of them together.

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

; case does not matter). The satellite should not send them in the first place; the server refuses them as well.
- `507 storage_quota_exceeded`: the tenant's connector files together would exceed the quota (5 GiB by default; feature option `maxStoredBytesPerTenant` of `createConnectorsFeature()`). Nothing is stored; free space or raise the option, retrying does not help. Parallel uploads can overshoot the quota by their combined size.

### Storage and backup

The delivered bytes are not part of the offsite backup: their storage keys start with `nobackup/<tenantId>/` (exported as `NO_BACKUP_STORAGE_PREFIX` from `@cosmicdrift/kumiko-framework/files`, so the mirror job can exclude it). The data lives on the customer's machine, and the satellite delivers it again when needed. Destroying the tenant deletes these files and the inbound items with it (mount `files-tenant-data`; `createFileRefFromBytes` and `uploadFileBytesBeforeTransaction` take `backup: false` for any other feature that wants the same).

### Folders

The path's directory part becomes a folder tree per device: a first upload of `Rechnungen/2026/a.pdf` creates the folders `Rechnungen` and `2026`. A path may have at most 20 folder levels and no segment longer than 255 characters (`422 path_rejected` otherwise). Folder names and file paths are stored encrypted.

## Heartbeat

`POST /v1/heartbeat` with the bearer token and a JSON body. Answer `200 {"ok":true}`. The connector list shows the version, the last time the device was seen (any upload counts as being seen too) and the sync status.

```json
{
  "version": "1.4.2",
  "sync": { "state": "syncing", "queued": 12, "failed": 0, "lastSyncAt": "2026-11-19T08:30:00Z" }
}
```

- `version`: 1 to 64 characters, required.
- `sync` is optional, so satellites without a status log keep working. `state` is `idle`, `syncing` or `error`; `queued` and `failed` are counts (0 or more); `lastSyncAt` is an ISO 8601 instant. Anything else is `400 invalid_request`. The list shows "In sync", "Running (12 in the queue)" or "3 failed". A `lastError` text is accepted and dropped: it is free text from the customer's machine and is not stored.
- Storage is throttled to once per 5 minutes, except that a change of `state` or `failed` (like a new version) is written at once.

**Retry signal.** An admin can press "Retry" on a connector whose sync failed. The satellite only connects outward, so the server answers the next heartbeat with `{"ok":true,"retry":true}` and clears the flag in the same step: the following heartbeat answers without `retry`. On `retry` the satellite requeues its failed files. An upload does not consume the signal, only a heartbeat does.

## Revoking

A TenantAdmin revokes a connector with `connectors:write:revoke`. Its token stops working at once (`401 invalid_token`), already delivered files stay.

## Admin screens

The feature ships four TenantAdmin screens. `connector-files` ("Dateien") shows the delivered files as a folder tree: breadcrumb, folders with file count and size over their whole subtree, the files of the open folder, and storage used against the quota. Row actions delete a file or a folder with everything below it, bytes included (a folder is marked "wird gelöscht" at once and no longer counts against the quota; the `delete-folder-tree` job removes everything below it in batches of 100, however many files). Columns Name, Größe and Eingang sort (folders stay first; Größe and Eingang sort in the database, Name within the page only because the name is encrypted). It is a custom screen: mount `connectorsClient()` from `@cosmicdrift/kumiko-bundled-features/connectors/web` in `clientFeatures`, set the quota once with `createConnectorsFeature({ maxStoredBytesPerTenant })` (upload check and screen read the same value), and place it with `r.nav({ id: "connector-files", label, screen: "connectors:screen:connector-files", parent })`. The other three: `connector-list` (connectors with status, last seen and version, a revoke action), `connector-pair` (enter the code; a code with no open request shows a hint) and `connector-confirm` (reached through the pair screen: request time and IP, a name, Confirm). All three are `dormant`: place the list in your admin area with one `r.nav({ id: "connectors", label, screen: "connectors:screen:connector-list", parent })`.

Without `verificationUri`, the satellite is shown `<origin>/connector-pair`, where origin is the origin of `APP_BASE_URL` if set, else the address the satellite reached. In an app with workspaces the shell moves such a link to the active workspace, so it opens the pair screen; behind a base path pass the full screen URL as `verificationUri`. The pair screen fills only `userCode` from the link (`linkPrefillFields`).

## Search in the file tree

File and folder names are encrypted, so `inbound-search` decrypts and scans them on the server: part of a name, ignoring case, at least two characters, in the open folder's subtree (or the whole tree). One search reads at most 20 000 names and returns at most 100 hits; hitting either limit answers `truncated: true` and the screen asks to switch into a folder. A hit opens its folder.
