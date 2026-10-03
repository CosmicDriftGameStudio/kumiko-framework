---
"@cosmicdrift/kumiko-server-runtime": patch
---

runProdApp warns at boot when neither `trustedProxyHops` nor `KUMIKO_TRUSTED_PROXY_HOPS` is set. Behind a reverse proxy all clients then share one IP-keyed rate-limit bucket.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: boot warning when trustedProxyHops is unset
migration: |
  Set `KUMIKO_TRUSTED_PROXY_HOPS` (for example 1 behind one ingress) or pass `trustedProxyHops` to runProdApp.
-->
