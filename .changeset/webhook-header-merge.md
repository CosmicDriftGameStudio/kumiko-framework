---
"@cosmicdrift/kumiko-bundled-features": patch
---

Webhook headers merge case-insensitively

A caller `Content-Type` replaces the default `application/json` instead of being joined with it. When a caller header collides with the auth header (any casing), the resolved secret value wins.

<!-- kumiko-changes
feature: step-dispatcher
type: fix
title: Webhook caller headers no longer merge with the default Content-Type or the auth header
-->
