---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Apps built with `createKumikoApp` show a hint while the server is unreachable, and live updates reconnect as soon as the device is back online.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Offline hint and immediate live reconnect
detail: `createKumikoApp` mounts a status banner (role status, aria-live polite) next to the update checker. It shows while the dispatcher status is `offline` or the browser reports no network, with the new key `kumiko.network.offline` in English, German, Spanish, French and Italian. `createEventSourceLiveEvents` reconnects on the window `online` event instead of waiting out the backoff; the new option `networkOnline` replaces that signal in tests or non-browser runtimes. After the reconnect every live list refreshes through the usual resync.
-->
