---
"@cosmicdrift/kumiko-bundled-features": patch
---

The sessions cleanup job now runs every day in the maintenance window, and the device list no longer shows expired sessions.

<!-- kumiko-changes
feature: sessions
type: fix
title: Sessions cleanup runs daily and the device list hides expired sessions
detail: `sessions:job:cleanup` was registered with a manual trigger only, and no app scheduled it, so `store_user_sessions` grew with every login and kept the encrypted IP and user agent of every session forever. The job now uses `trigger: { maintenance: true }` with `concurrency: "skip"` and deletes rows expired or revoked more than 30 days ago once a day in the app's maintenance window (`KUMIKO_MAINTENANCE_WINDOW`, default 03:00 UTC). Starting it by hand from the job-runs screen still works. `user-session:mine` now also filters on `expiresAt` in the future, so a session that ran out without a logout no longer appears as active.
-->
