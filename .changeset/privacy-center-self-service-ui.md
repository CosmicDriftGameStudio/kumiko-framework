---
"@cosmicdrift/kumiko-bundled-features": minor
---

feat(user-data-rights): Privacy-Center self-service UI (Art. 15/17/18/20)

Adds `userDataRightsClient()` and a dormant `privacy-center` custom screen that
wires data export (Art. 20), the activity log (Art. 15), processing restriction
(Art. 18), and account deletion (Art. 17) to the existing server handlers. Apps
mount the client factory in `createKumikoApp({ clientFeatures: [userDataRightsClient()] })`
and place the screen via `r.nav` in their authenticated area — no per-app UI to
build. Art. 18 lift stays out of the screen by design (a restricted account is
login-blocked and cannot reach it; lifting runs via support / magic-link).
