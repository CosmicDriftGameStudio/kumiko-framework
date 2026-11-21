---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

The no-raw-hooks lint rule also checks .ts files under web/ and public/.

<!-- kumiko-changes
feature: framework
type: fix
title: no-raw-hooks also checks .ts files under web/ and public/
detail: The Biome rule `no-raw-hooks` used to look at .tsx files only, so a raw `useEffect` inside a hook file such as `web/use-thing.ts` slipped through. Apps with a raw useEffect in web/*.ts or public/*.ts hooks now see the lint error. Migration: use a framework hook (`useDraft` with `initialFrom` for a form draft from query data, `useQuery`, `useNow`, `useDebouncedValue`) or add a `biome-ignore lint/plugin` with a reason for a real DOM integration.
-->
