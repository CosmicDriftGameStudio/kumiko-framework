---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Fixed three renderer defects visible in every app (fw#2569):

- The sessions and tenant-members projectionList screens showed raw ISO timestamps for `createdAt`/`expiresAt`/`revokedAt`/`lastSeenAt` — those columns now declare `renderer: { format: "timestamp" }` like their detail-screen counterparts already did.
- `defaultCellRender` now warns once per column (dev builds only) when a `text` column renders a full ISO-8601 datetime string, pointing at the missing `renderer: { format: "timestamp" }` — the value itself is still rendered unchanged, no auto-formatting/guessing.
- The desktop sidebar's nav label now carries a native `title` attribute with the full label, so a truncated entry (e.g. "Händler-Einstellungen (Plattform-Standard)") is still reachable via hover instead of being silently cut off.
