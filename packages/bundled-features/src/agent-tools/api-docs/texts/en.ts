import type { ApiDocsTexts } from "./types.ts";

export const enApiDocsTexts = {
  text: {
    "overview.title": "HTTP API",
    "overview.description":
      "Endpoints, request body, responses, error codes, lists and batches of the HTTP API.",
    "overview.intro":
      "Every call is a POST with a JSON body. The `type` field names the handler, `payload` carries its fields. The reference pages list every handler with its fields.",
    "overview.endpoints.heading": "Endpoints",
    "overview.endpoints.query": "Reads data. Never changes anything.",
    "overview.endpoints.write": "Changes data: create, update, delete or a specific action.",
    "overview.endpoints.batch": "Runs several write calls in one transaction.",
    "overview.auth.heading": "Authentication",
    "overview.auth.body":
      "Send an API token in the `Authorization` header as `Bearer <token>`. Requests with a token need no cookie and no CSRF token. The token also fixes the account the request runs in, so you never send an account or tenant ID.",
    "overview.body.heading": "Request body",
    "overview.body.body":
      "`type` is the handler name, for example `{exampleType}`. `payload` holds the fields from the reference. `requestId` is optional, see below. The payload may be nested at most {maxDepth} levels deep.",
    "overview.responses.heading": "Responses",
    "overview.responses.success":
      "A successful read returns `data`. A successful write returns `isSuccess: true` and `data`.",
    "overview.responses.error":
      "On failure the HTTP status is 4xx or 5xx and the body contains `error`. Write calls also return `isSuccess: false`. Branch on `error.code` and the status. `message` is meant for people and may change.",
    "overview.errors.heading": "Error codes",
    "overview.errors.columns": "Code | HTTP status | Meaning",
    "overview.versions.heading": "Versions and conflicts",
    "overview.versions.body":
      "Every record has a `version`. An update takes the `version` you read last. If someone changed the record in between, the call fails with 409 `version_conflict`. Read the record again, check the change and send it with the new version.",
    "overview.lists.heading": "Lists",
    "overview.lists.intro": "List handlers end in `:list` and accept these fields:",
    "overview.lists.columns": "Field | Type | Description",
    "overview.lists.response":
      "The response contains `rows` and `nextCursor`. For the next page send `nextCursor` as `cursor`. On the last page `nextCursor` is `null`.",
    "overview.batch.heading": "Batches",
    "overview.batch.body":
      "`POST /api/batch` takes `commands`, a list of `{ type, payload }` write calls. They run in one transaction: if one fails, none takes effect. The response then has `isSuccess: false`, the `error` and `failedIndex`, the position of the failed command counted from 0.",
    "overview.retry.heading": "Safe retries",
    "overview.retry.body":
      "Send a `requestId` with write and batch calls, any string that is unique per change. If the connection drops and you send the same call again with the same `requestId`, you get the first result back and the change does not run twice.",
    "tokens.title": "API tokens",
    "tokens.description":
      "Create an API token for {appName}, choose its scopes and send it with your requests.",
    "tokens.intro":
      "An API token lets a script or another service call the {appName} API in your name. Its scopes decide which data it may read or change.",
    "tokens.create.heading": "Create a token",
    "tokens.create.step1": "Open {menuPath}.",
    "tokens.create.step2": "Choose **{createLabel}**.",
    "tokens.create.step3":
      "Enter a name, pick the scopes and the expiry, and confirm with your password.",
    "tokens.create.step4": "Copy the token. It starts with `kpat_` and is shown only once.",
    "tokens.expiry":
      "A token expires after {defaultDays} days unless you pick another expiry. The longest possible expiry is {maxDays} days.",
    "tokens.use.heading": "Use the token",
    "tokens.use.body":
      "Send the token in the `Authorization` header. Requests with a token need no cookie and no CSRF token.",
    "tokens.scopes.heading": "Scopes",
    "tokens.scopes.intro":
      "Each scope comes in two levels. `read` allows the read handlers. `write` allows everything `read` allows plus the write handlers.",
    "tokens.scopes.columns": "Scope | Grant | Handlers",
    "tokens.rateLimit.heading": "Rate limit",
    "tokens.rateLimit":
      "Each token may send {max} requests per {windowSeconds} seconds. Above that the API answers 429 `pat_rate_limited`.",
    "tokens.errors.heading": "Errors",
    "tokens.errors.columns": "HTTP status | Code | Cause",
    "tokens.errors.missing": "No `Authorization` header.",
    "tokens.errors.invalid": "The token is unknown, revoked or expired.",
    "tokens.errors.scope": "The token lacks the scope for this handler.",
    "tokens.errors.route":
      "The endpoint does not accept tokens. Tokens work only on the API endpoints.",
    "tokens.errors.rate": "Too many requests from this token.",
    "tokens.errors.disabled": "API tokens are not part of your plan.",
    "tokens.revoke.heading": "Revoke a token",
    "tokens.revoke.body":
      "Revoke a token in {menuPath} as soon as you stop using it. Changing your password revokes all your tokens. A token always acts with your current roles. If you leave the account or your user is deleted, it stops working.",
    "tokens.security.heading": "Security",
    "tokens.security.item1":
      "Treat a token like a password. Keep it in a secret store, never in code, a repository, an app or web page, or a log.",
    "tokens.security.item2": "Give each script its own token with only the scopes it needs.",
    "tokens.security.item3":
      "Revoke tokens you no longer use. Revoke a token at once if it may have leaked.",
    "reference.description":
      "API reference for {scopeLabel}: every handler with its fields and an example.",
    "reference.requiredScope": "Required scope",
    "reference.endpoint": "Endpoint",
    "reference.fields.columns": "Field | Type | Required | Description",
    "reference.yes": "yes",
    "reference.no": "no",
    "reference.noFields": "This handler takes no fields.",
    "reference.excluded": "Not settable through the API: {fields}.",
    "reference.exampleRequest": "Example request",
    "reference.exampleResponse": "Example response",
    "reference.status": "Status: {status}",
    "events.title": "Webhook events",
    "events.description":
      "Webhook events: when they fire, which scope they need and what their payload contains.",
    "events.intro":
      "A webhook event tells your system that something changed. Every event has a name, a version and a payload. The scope listed for an event is the token scope that allows subscribing to it.",
    "events.delivery.heading": "Delivery",
    "events.versions.heading": "Versions",
    "events.versions.body":
      "Adding an optional field keeps the version. A breaking change, such as removing or renaming a field or changing its type, gets a new version.",
    "events.list.heading": "Events",
    "events.version": "Version",
    "events.requiredScope": "Required scope",
    "events.example": "Example payload",
    "events.noFields": "This event carries no fields.",
    "events.entity.created": "A record of type {entity} was created.",
    "events.entity.updated": "A record of type {entity} was updated.",
    "events.entity.deleted": "A record of type {entity} was deleted.",
  },
  errorMeanings: {
    validation_error:
      "The payload does not match the handler's fields. `details` names the fields.",
    unauthenticated: "No valid credentials were sent.",
    missing_token: "The `Authorization` header is missing.",
    invalid_token: "The token is unknown, revoked or expired.",
    ambiguous_auth: "The request carried both a session cookie and a token. Send only one.",
    access_denied:
      "The token lacks the scope for this handler, or the endpoint does not accept tokens.",
    feature_disabled: "This function is switched off or not part of your plan.",
    not_found: "The record does not exist or you cannot see it.",
    conflict: "The change conflicts with the current state of the data.",
    version_conflict:
      "The record changed after you read it. Read it again and retry with the new `version`.",
    precondition_failed:
      "A field of the record no longer has the value the change expected. Read the record again and retry.",
    record_locked: "Another change holds a lock on the record. Retry shortly.",
    idempotent_replay:
      "This change was already applied under the same idempotency key. The first attempt succeeded, so do not send it again.",
    unique_violation: "A record with this value already exists.",
    unprocessable:
      "The data is valid, but a business rule rejects the change. `details.reason` names the rule.",
    unconfigured:
      "A setting this function needs is still empty. Set it up in the app first, then retry.",
    internal_error: "Unexpected server error. Retry later.",
    member_read_timeout: "A read on the server took too long and was stopped. Retry later.",
    rate_limited: "Too many requests. Wait as many seconds as the `Retry-After` header says.",
    rate_limit_unavailable:
      "The rate limiter is temporarily unavailable, so the request was refused. Retry shortly.",
    pat_rate_limited: "This token sent too many requests in a short time. Wait a moment and retry.",
  },
  listParameters: {
    cursor: "Position from `nextCursor` of the previous page.",
    limit: "Rows per page, {default} by default, at most {max}.",
    search: "Full-text search across the searchable fields.",
    sort: "Field to sort by.",
    sortDirection: "`asc` or `desc`.",
    offset: "Number of rows to skip. Prefer `cursor` for paging.",
    totalCount: "Set `true` to also get `total`, the number of matching rows.",
    includeDeleted: "Set `true` to include deleted rows. Only for entities with soft delete.",
    onlyDeleted:
      "Set `true` to return only deleted rows. Only for entities with soft delete, not together with `includeDeleted`.",
    filter: "One field filter with `field`, `op` and `value`. `op` is one of {ops}.",
    filters: "Several field filters, each with `field`, `op` and `value`. `op` is one of {ops}.",
    namedFilter: "Name of a predefined filter of the entity, for example a work queue.",
    aggregate: "Returns aggregated values instead of rows.",
  },
} as const satisfies ApiDocsTexts;
