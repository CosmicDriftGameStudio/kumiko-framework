---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
---

EXT_USER_DATA is framework-owned; folders, form-draft, notes-history, template-resolver and auth-mfa register their GDPR hooks themselves, and the five `*-user-data` adapter features are removed.

<!-- kumiko-changes
feature: user-data-rights
type: breaking
title: User-data adapter features merged into their owner features
detail: `EXT_USER_DATA` is defined by the framework (`FRAMEWORK_OWNED_EXTENSIONS`), so any feature registers `r.useExtension(EXT_USER_DATA, ...)` without `requires("user-data-rights")`; user-data-rights runs the hooks whenever it is mounted and a feature calling `r.extendsRegistrar(EXT_USER_DATA, ...)` now fails with "Duplicate registrar extension". folders, form-draft, notes-history, template-resolver (for `user-content-entry` when a user-owned collection is mounted) and auth-mfa register their export and delete hooks themselves. Removed: the subpaths `@cosmicdrift/kumiko-bundled-features/folders-user-data`, `/form-draft-user-data`, `/notes-history-user-data`, `/template-resolver-user-data` and `/auth-mfa-user-data` with their exports `createFoldersUserDataFeature`, `createFormDraftUserDataFeature`, `createNotesHistoryUserDataFeature`, `createTemplateResolverUserDataFeature` and `createAuthMfaUserDataFeature`, and the shared helper `registerUserDataHooks`. `eraseNoteBodiesReachingSubject` moved from `/notes-history-user-data` to `@cosmicdrift/kumiko-bundled-features/notes-history`.
migration: Delete `createFoldersUserDataFeature()`, `createFormDraftUserDataFeature()`, `createNotesHistoryUserDataFeature()`, `createTemplateResolverUserDataFeature()` and `createAuthMfaUserDataFeature()` and their imports from the feature list; the owner features already carry the hooks. Import `eraseNoteBodiesReachingSubject` from `@cosmicdrift/kumiko-bundled-features/notes-history`. App features that only call `r.useExtension(EXT_USER_DATA, ...)` may drop `requires("user-data-rights")`.
-->
