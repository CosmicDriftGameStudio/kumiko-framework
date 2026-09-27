---
"@cosmicdrift/kumiko-bundled-features": minor
---

The framework's unsubscribe route wrote an opt-out on a plain `GET` — a link that any prefetcher, email scanner, or antivirus crawler could trigger just by following it, with no user intent behind the write. It also had no `List-Unsubscribe`/`List-Unsubscribe-Post` headers, so mail clients offering RFC-8058 one-click unsubscribe had nothing to act on.

`GET /api/delivery/unsubscribe?token=` now renders a minimal confirmation page and writes nothing; the opt-out only happens on `POST` to the same path, with the token read from a form-urlencoded body (confirmation-page submit or a one-click client) or, failing that, the query string. `channel-email` now sets `List-Unsubscribe` / `List-Unsubscribe-Post: List-Unsubscribe=One-Click` automatically whenever a message's `data.unsubscribeUrl` points at this route — apps with their own GET-only unsubscribe page don't get the header, since only the framework route can honor a one-click POST.

<!-- kumiko-changes
feature: delivery
type: breaking
title: Unsubscribe route splits into a non-writing GET confirmation page and a writing POST (RFC 8058)
detail: |
  `createUnsubscribeRoute({ secret })`, which mounted a single `GET` route
  that wrote the opt-out as a side effect of the request, is replaced by
  `createUnsubscribeRoutes({ secret })`, which returns both routes for the
  same path: `GET` renders a confirmation page (`<form method="post">`) and
  performs no write; `POST` performs the write, reading the token from a
  form-urlencoded body first, then the query string as a fallback (so an
  RFC-8058 one-click client that POSTs `token=` only in the URL still works).
  Token verification and error mapping (`400 unsubscribe_token_invalid`) are
  unchanged and shared between both routes.
migration: |
  Replace `extraRoutes: [createUnsubscribeRoute({ secret })]` with
  `extraRoutes: [...createUnsubscribeRoutes({ secret })]`.

  Unsubscribe links already mailed out before this upgrade now show a
  confirmation page on click instead of unsubscribing immediately — the
  recipient must submit the form (or a one-click mail client must POST) to
  complete the opt-out. If the app rendered its own confirmation page in
  front of the old GET link, it can be removed; the framework route now
  covers that step.
-->

<!-- kumiko-changes
feature: channel-email
type: improvement
title: Automatic List-Unsubscribe / List-Unsubscribe-Post headers for messages that carry a framework unsubscribeUrl
detail: |
  `createEmailChannel`'s `send()` now sets `List-Unsubscribe: <url>` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` whenever the
  notification's `data.unsubscribeUrl` is an `http(s)` URL whose path is
  the delivery feature's `DELIVERY_UNSUBSCRIBE_PATH` — only that route can
  honor a one-click POST. An explicit `data.headers["List-Unsubscribe"]`
  (or `-Post`) still wins over the automatic value. Apps whose
  `unsubscribeUrl` points somewhere else (their own page, a foreign path)
  get no automatic headers.
migration: |
  No action needed for apps already using the framework's unsubscribe
  route via `data.unsubscribeUrl`. Apps with a GET-only unsubscribe page of
  their own keep getting no `List-Unsubscribe-Post` header, since a
  one-click POST there would 404 or no-op.
-->
