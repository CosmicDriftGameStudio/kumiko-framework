---
"@cosmicdrift/kumiko-renderer": patch
---

A projectionDetail header subtitle stays visible on a host with `PageHeader` but no `MetricBand`. `navigateToReturn` applies the restored host state only when the return target is the host the `returnTo` value names, so a caller-supplied target no longer inherits a foreign host's tab, filters and nested `returnTo`. The `screenPadding` and `scrollBody` docs now state that `scrollBody` wins, and the number input docs match the web behavior.

<!-- kumiko-changes
feature: renderer
type: fix
title: Header subtitle without MetricBand and navigateToReturn state no longer misbehave
-->
