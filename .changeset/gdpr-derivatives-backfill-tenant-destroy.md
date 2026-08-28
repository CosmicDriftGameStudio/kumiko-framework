---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Closes the two gaps #2461 left open (GDPR derivative cleanup for `fileRef`):

- New `files-tenant-data` feature registers an `EXT_TENANT_DATA` hook that hard-purges every `fileRef` row for a tenant on tenant-destroy (mirrors the existing per-user forget hook), and a new `EXT_STORAGE_PROVIDER` extension point (`destroyTenant` hook) that wipes every binary under the tenant's storage prefix — originals, derivatives, and anything else — once a file provider is resolvable. Neither stage fails the destroy pipeline when no file provider is wired; the row purge still runs, only the binary wipe degrades to a no-op.
- A manual (operator-triggered) `sweep-orphaned-derivatives` job backfills/GCs derivatives that were rendered before #2461 shipped: it lists each tenant's storage prefix, reconstructs the would-be original key from the derivative-key grammar, and deletes any derivative whose original has no `fileRef` row left (trashed rows still count as an owner — only a fully absent row makes a derivative orphaned).

Mount `files-tenant-data` alongside `tenant-lifecycle` and `files` to get both. Not a breaking change for existing `FileStorageProvider`/`UserDataStorageProvider` implementations.
