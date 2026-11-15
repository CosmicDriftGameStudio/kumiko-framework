---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

An actionForm redirect or success link to a custom screen now carries the record id when it sets `idFrom`, so a custom screen that reads its record from the route opens on it. The caller's `returnTo` no longer overrides such a redirect, and the boot validator accepts `idFrom` on a custom screen.

<!-- kumiko-changes
feature: framework
type: fix
title: A redirect with idFrom opens a custom screen on its record
detail: `redirect: { screen, idFrom }` and success links with `idFrom` to a custom screen pass the payload field as the route id (`nav.route.entityId`) and win over the caller's `returnTo`, like a redirect to an entityEdit or projectionDetail screen. Without `idFrom` a custom target stays id-less and `returnTo` still wins. The boot rule `screen/redirect-id-from-on-idless-target` no longer rejects `idFrom` on a custom screen.
-->
