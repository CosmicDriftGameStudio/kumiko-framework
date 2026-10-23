---
"@cosmicdrift/kumiko-bundled-features": patch
---

Session lists and the session detail show the device as text without sessionsClient().

<!-- kumiko-changes
feature: sessions
type: fix
title: Session screens show the device without sessionsClient()
detail: The list, my-sessions and detail screens showed [object Object] in the device column for apps that do not register sessionsClient(). The session queries (user-session:list, user-session:mine, user-session:detail) now return a deviceLabel string such as "Chrome 141 · macOS" next to the unchanged device object, null when the user agent is unknown, and the screens render that field. sessionsClient() only adds the translated "Unknown device" for rows without a label.
-->
