---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

New opt-in feature tenant-inactivity: abandoned free accounts get warning mails, then the regular deletion request.

<!-- kumiko-changes
feature: tenant-inactivity
type: improvement
title: Warn and delete inactive free accounts
detail: createTenantInactivityFeature({ rule } or { resolveTier, rulesByTier }, keepAccountUrl, keepAccountTokenSecret?, activitySources?) mounts a daily maintenance job that warns the tenant owners by mail before the deadline (rule.warnings, for example 30 and 7 days) and then files the normal tenant-lifecycle deletion request, with the wait period of the compliance profile. A new session, an activity source or the keep-account link in the mail restarts the period; a tier whose rule is null is exempt. The query tenant-inactivity:query:state (optional field tenantIdOverride, only for a SystemAdmin, to read another tenant) shows exempt, lastActivityAt, warningsSent, nextStep and nextStepAt. The feature requires sessions, tenant, tenant-lifecycle and delivery, and erases its state with the tenant data. Mail texts exist in en, de, es, fr and it.
-->

<!-- kumiko-changes
feature: sessions
type: improvement
title: clock option and lastActivityProbeSecret
detail: createSessionsFeature and createSessionCallbacks accept a clock option for deterministic tests. With lastActivityProbeSecret set, the sessions feature serves GET /sessions/last-activity for other apps of the same account (Bearer secret, constant-time compare, rate limited, 401 otherwise); the secret must be at least 32 characters, shorter ones fail at boot; without the option no route exists. fetchRemoteAppLastActivity({ url, secret }) from tenant-inactivity reads it as an activity source and uses internal egress restricted to the origin of the URL.
-->

<!-- kumiko-changes
feature: tenant-lifecycle
type: improvement
title: requestTenantDestruction extracted
detail: The core of the request-destruction handler is exported as requestTenantDestruction({ tenantId, actor, now, db, runner, registry, revokeSessions }) so other features, such as tenant-inactivity, file the same deletion request. The handler behavior is unchanged.
-->
