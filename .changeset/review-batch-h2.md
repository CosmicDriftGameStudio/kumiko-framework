---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-dev-server": minor
---

Review batch H2: framework parts of consumer-app findings.

- `file-derivatives`: the `isPublic` predicate args carry `fileRefId`, so a predicate can reject a client-spoofed FileRef that claims another entity's `entityId`/`fieldName`.
- `sessions`: `createSessionsFeature({ adminAccess: "systemAdmin" })` narrows the admin list/detail queries and both admin screens together (default `"admin"`, unchanged).
- `user-profile`: `change-email` is open to every signed-in user (`openToAll`), so a tenant member whose only role is `TenantAdmin` can change their own email; the handler still re-checks the password.
- `notes-history`: composite index on `(tenantId, entityType, entityId)` for note entries. Apps run `kumiko-schema generate` after the bump.
- guards: `// kumiko-lint-ignore a,b reason` suppresses several guards on one line (`lineHasIgnoreTag`); `primitives-discipline` and `no-custom-primitives` honour it.
- dev-server: `kumiko-build --check` verifies `.kumiko/` is current without writing (exit 1 on drift); `runCodegen` takes `checkOnly`.
