---
"@cosmicdrift/kumiko-renderer": patch
---

Polling queries and presence heartbeats pause while the browser tab is hidden.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Polling and presence pause in hidden tabs
detail: `useQuery` with `refetchIntervalMs` skips its ticks while the page is hidden and fetches once as soon as it is visible again. `usePresence` sends no heartbeat and ignores presence signals while the page is hidden and beats once when it becomes visible, so a hidden tab drops out of the roster after the presence expiry instead of reporting a user nobody sees. `usePresenceList` pauses its polling and signals the same way. `createKumikoApp` and `createPublicSurface` read the state from `document.visibilityState`; without them (React Native, tests) the page counts as always visible.
-->
