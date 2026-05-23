---
"@cosmicdrift/kumiko-bundled-features": minor
---

T1 — integration tests for custom-fields bundle. 6 full-stack scenarios via setupTestStack:
- Define field → set value → query: customField lands flat in entity-response (postQuery hook + MSP)
- Clear: fieldKey gone from response after clear-custom-field
- Multiple fields on same entity: all merge flat
- Entity without customField values: still queryable
- fieldDefinition-delete cascade: orphan values removed from all entity-rows via MSP
- Last-Wins on concurrent set: last value wins (unsafeAppendEvent without expectedVersion)

Plus bugfix: Event-short-name-constants haben jetzt kebab-dashes statt Punkten (toKebab collapsed dots → Registry-Drift bei type-string-templates).
