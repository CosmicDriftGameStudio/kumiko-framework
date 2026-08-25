---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

user admin UX: `roles` is a multiSelect (jsonb string[]) so SystemAdmin can promote peers in entityEdit; user-list shows roles + membership tenants. switch-tenant and auth-client use `parseRoles` so jsonb arrays survive tenant switches (string-only parse dropped SystemAdmin). Last-admin roster query passes a JS array to jsonb `@>` (stringified params double-encode via postgres.js).
