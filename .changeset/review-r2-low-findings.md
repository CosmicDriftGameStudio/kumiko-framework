---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Stricter boot checks and role projection for screens and handlers

Inline handler registration without `options.access` now throws immediately, a section with `fields: []` and `groups: []` fails boot, and unknown tones in `header.statusTones` or select `optionTones` fail boot instead of dropping the badge colour. The renderer falls back to the value heuristic for an unknown tone, and `statusToneForOptionTone` now returns `undefined` for it. `secretMint` confirm-step actions are stripped for roles that cannot see the target screen.

Entity convention `create` handlers keep tenant-filtered lookups even when the handler declares `escapeHatch`/`crossTenant`. Duplicate `waitForEvent` steps on the same `awaits` event are rejected when the workflow pipeline is built. An empty `PROMETHEUS_METRICS_TOKEN` counts as unset instead of failing boot.

`GET /api/sse` now closes itself when the JWT it was opened with expires. File uploads must attach to a registered file field (a non-file field answers 400 `unresolvable_field`), and a `.docx` upload must be a ZIP containing `word/` entries. Signature extra routes outside `/api` get the request-body cap (`maxRequestBytes`) before their body is read. `EXT_USER_DATA` registrations with neither an export nor a delete hook fail boot. The dashboard updated-at stamp follows live refetches and retries.

Text fields accept `minLength` (enforced by the generated write schema), `enumOption` renders array values per entry, list columns can opt out of sorting with `sortable: false`, and `BUILT_IN_MEMBERSHIP_ROLES` exposes the ranked membership roles. The PAT list translates its scopes column, MFA code fields enforce their minimum length, plan checkout no longer repeats the billing-enabled and active-subscription gates.

<!-- kumiko-changes
feature: framework
type: fix
title: Unknown status tones fail boot and secretMint confirm actions respect role gating
-->

`jobs:query:list` (job-runs screen) now pages with a `cursor` and returns `nextCursor` while older runs exist. Ledger `create-transaction` requires `subjectType` and `subjectId` together and rejects empty strings (also on schedule fields). The form-draft sweep re-check is tenant-scoped. A workflow run resumed without a stored definition fingerprint logs a warning.

`EventDef.piiFields` is now required in the type, screen definitions accept only `agent: { expose }` (`AgentScreenHints`), and `FormController.validate(scope)` rejects field names that the form values do not have. The dedupe doc and the security-baseline recipe note that late-bound state (sessions auto-revoke) binds on the kept instance.

A text or longText field with `multiline.rows` that is not a positive integer now fails the app-schema build with the entity or screen and field name instead of silently rendering four rows. List columns of type multiSelect render one pill per value like select columns. `config:query:values` accepts an optional `keys` list, and the tenant-currency lookup of money fields asks for its one key only.

`createKumikoApp` accepts `schemaUrl` for the schema fetch when the API lives on another origin than the SPA (a cross-origin URL is fetched with `credentials: "include"`). List select cells and a danger `Dialog` now follow the registered primitives: select pills use the registered `StatusBadge`, and a danger dialog focuses Cancel by default. Form drafts no longer store fields marked `sensitive: true`.

German and Spanish translations for `jobs.errors.invalidCursor` were missing.

The release workflow waits for npm `latest` only on the packages the changesets run actually published and skips packages published under another dist-tag. `check:dist` compiles the installed `styles.css` and fails when classes from renderer-web or the renderer's compiled dist are missing.
