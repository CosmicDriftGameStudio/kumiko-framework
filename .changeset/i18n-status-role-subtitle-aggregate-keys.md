---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Untranslated member status/roles, screen subtitles and audit aggregate columns now go through i18n

<!-- kumiko-changes
feature: tenant
type: fix
title: Team member status and roles now translate instead of showing the raw enum value
detail: |
  member-status-cell and member-roles-cell rendered the raw status/role
  enum values (e.g. "active", "TenantAdmin") straight into the table —
  non-English admin UIs showed English words next to translated column
  labels. Both cells now resolve through useTranslation against the
  existing tenant.members.filter.status.option.<status> and
  tenant:entity:__action-form__:field:roles:option:<role> keys, falling
  back to the raw value for any status/role not covered by those keys.
-->

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: Privacy-center screen subtitle is now translatable
detail: |
  The Privacy screen's description was hardcoded English prose baked
  into feature.ts instead of an i18n key, so it never localized. It's
  now userDataRights.privacyCenter.subtitle, registered in i18n.ts with
  de/es translations.
-->

<!-- kumiko-changes
feature: audit
type: fix
title: Audit-log-detail screen subtitle is translatable; aggregate columns get de/es copy
detail: |
  The audit-log-detail screen's description was hardcoded English prose;
  it's now the audit.log.detail.subtitle key with de/es translations.
  Separately, audit.log.col.aggregateType/aggregateId (the actual column
  keys the audit-log-detail screen renders) had no de/es copy at all —
  only the dead, unused audit.log.col.aggregate key did. Added
  aggregateType/aggregateId to de/es, removed the dead aggregate key, and
  fixed the German filter label typo "Aggregate-Typ" -> "Aggregattyp".
-->

<!-- kumiko-changes
feature: agent-tools
type: fix
title: Agent manifest now resolves a screen's i18n-key description to English prose
detail: |
  buildAgentManifest passed screen.description straight through even when
  a feature registered it as an i18n key (e.g. "audit.log.detail.subtitle")
  rather than literal text, so agents saw the raw key instead of prose.
  It now resolves through the registry's translations the same way
  labelsForSuffix already does for entity/field labels, falling back to
  the literal string when the description isn't a registered key.
-->
