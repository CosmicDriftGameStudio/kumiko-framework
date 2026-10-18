---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

HTTP spans and metrics use the route pattern instead of the raw request path

The `http.route` span attribute and the `route` label on `kumiko_http_requests_total` and `kumiko_http_request_duration_seconds` now carry the matched route pattern (`/api/heartbeat/:token`), or `unmatched` when no route matched. Raw paths put path-param secrets into traces and gave every id its own metric series. The span is named `GET /api/heartbeat/:token` instead of `http.request`, and the `http.target` attribute is gone.

`observabilityOptions` (`BaseEntrypointOptions`, `RunProdAppOptions`, `RunWorkerAppOptions`) is deprecated and has no effect anymore: it only configured query-string redaction, and the route label carries no query string. `ServerOptions.observabilityOptions` is removed.

<!-- kumiko-changes
feature: framework
type: breaking
title: http.route and the metric route label carry the route pattern, http.target is removed
detail: Spans are named "METHOD pattern" instead of "http.request"; paths no route matched are labelled "unmatched". The PII ciphertext guard message names the pattern as well.
migration: Dashboards, alerts and trace queries keyed on raw paths or on the span name "http.request" must switch to route patterns and the "METHOD pattern" span name. Read the query string from your access logs if you relied on http.target.
-->
