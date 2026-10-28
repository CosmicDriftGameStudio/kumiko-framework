---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

The shell header shows a notification bell when the app includes the channel-in-app feature.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Notification bell in the shell header
detail: With the channel-in-app feature in the schema and a signed-in user, ShellHeader renders a bell with an unread badge (99+ from 100) and a popover list with title, body, relative time, mark all read and load more. A click marks the entry read and opens its target screen when the schema has it. The delivered signal refetches the count and the open list; there is no polling. SSE frames without an aggregateType now reach subscribers keyed by the frame name. New keys `kumiko.notifications.*` in the default bundle and in all four locale packages.
-->
