---
"create-kumiko-app": patch
---

The scaffold passes the app name to `createUserDataRightsFeature`, so a new app with a mail transport boots.

<!-- kumiko-changes
feature: create-kumiko-app
type: fix
title: Scaffolded apps name themselves in the GDPR mails
detail: `bun create kumiko-app <name>` wrote `createUserDataRightsFeature()` without `mailDefaults`. Once a mail transport was picked or added, boot failed with `user-data-rights/mail-app-name-missing`. The generated `run-config.ts` now contains `createUserDataRightsFeature({ mailDefaults: { appName: "<name>" } })`.
migration: Apps scaffolded before this release add `mailDefaults: { appName: "<your app>" }` to `createUserDataRightsFeature` by hand.
-->
