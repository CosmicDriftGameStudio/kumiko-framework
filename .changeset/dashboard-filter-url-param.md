---
"@cosmicdrift/kumiko-renderer-web": patch
---

Back a dashboard screen's filter value with a URL search param (`nav.searchParams[filter.id]`) instead of local state, matching `useListUrlState`'s replaceState semantics for pagination. A `navigate` rowAction's `params` extractor can now deep-link into a dashboard's filter — the value is bookmarkable and survives a reload, the same way an entityList/projectionList filter prefill already did.
