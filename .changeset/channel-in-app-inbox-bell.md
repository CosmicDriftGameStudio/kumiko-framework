---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-types": minor
---

The channel-in-app inbox pages with a cursor, reports a total and parses a navigation target per notification.

<!-- kumiko-changes
feature: channel-in-app
type: improvement
title: Inbox cursor, total and navigation target for the shell bell
detail: `channel-in-app:query:inbox` accepts a `cursor` and answers `{ rows, nextCursor, total }`; each row carries `target` (`{ screenId, entityId? }` or null) parsed from `data.target`. Build the target with `inAppTarget(screenId, entityId?)`; a malformed target is dropped and the notification is still delivered. The SSE frame `channel-in-app:event:delivered` now carries only `{ id, userId, notificationType }`, and a failing push no longer fails the delivery because the row is already stored. The shared contract lives in `@cosmicdrift/kumiko-types/in-app-notification-types`.
-->
