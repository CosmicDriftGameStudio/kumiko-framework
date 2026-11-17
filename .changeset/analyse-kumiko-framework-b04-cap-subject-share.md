---
"@cosmicdrift/kumiko-bundled-features": patch
---

A calendar cap can limit one subject, such as a user, to a share of the cap.

<!-- kumiko-changes
feature: cap-counter
type: feature
title: Per-subject share of a calendar cap
detail: `withCapEnforcement`, `reserveCalendarCapUsage`, `calendarCapReservationHandle`, `enforceCap` and `enforceCapAndMaybeNotify` take `subject: { key, share? }`, and `bookCapUsage` takes `subjectKey`. The subject (use `subjectKeyForUser(userId)` for users, any stable string otherwise) is stored only as an HMAC under `KUMIKO_BLIND_INDEX_KEY`; a booking without that key throws. With `share` the subject is blocked at `floor(limit * share)` with the cap's tolerance profile and a `cap_exceeded` error with `details.scope: "subject"`. Subject rows are deleted by forget-subject and the Art. 17 cleanup, and rows of earlier periods on the next subject booking. `DEFAULT_AI_CAP_SUBJECT_SHARE` (0.25) is the suggested share for AI cost caps.
-->
