---
"@cosmicdrift/kumiko-framework": patch
---

Session rows now track a `lastSeenAt` timestamp, set at creation and refreshed by `sessionChecker` at most once per hour. Gives apps a coarse "last activity" signal (e.g. for the session-list UI) without a DB write on every authenticated request.
