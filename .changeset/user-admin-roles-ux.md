---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

user admin UX: `roles` is a multiSelect (jsonb string[]) so SystemAdmin can promote peers in entityEdit; user-list shows roles + membership tenants. Last-admin roster query passes a JS array to jsonb `@>` (stringified params double-encode via postgres.js).
