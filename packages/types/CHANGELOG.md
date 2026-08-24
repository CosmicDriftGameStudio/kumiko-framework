# @cosmicdrift/kumiko-types

## 0.216.0

## 0.215.7

## 0.215.6

## 0.215.5

## 0.215.4

## 0.215.3

## 0.215.2

## 0.215.1

## 0.215.0

### Minor Changes

- 67805ac: `FieldFormatRegistry` gains an `enumOption` format key (`{ format: "enumOption", keyPrefix: "..." }`) that resolves an enum value to its translated label through the standard option-key convention (`<feature>:entity:<entity>:field:<field>:option:<value>`), client-side.

  `applyFormatSpec` takes an optional `translate` parameter; `FieldRendererOutput` (`projectionDetail` fields) and `DataTableCell` (`entityList`/`projectionList`/`relatedList` columns) now pass `useTranslation()` through. An untranslated key falls back to the raw enum value, mirroring `buildOptionLabels`'s convention for `entityList` select columns.

  This closes the last gap that forced server-side enum translation via hand-rolled locale dictionaries (fw#2315, solon#203): a query handler no longer needs to know the request's locale to make an enum value readable.

- 2bcf3c9: `SessionUser` gains an optional `locale` field, carried in the JWT `locale` claim alongside the existing `timezone` claim. It's set at login from the user's stored `locale` column (the same column `user:update` already lets users change explicitly) and threaded through every session-minting handler (login, invite-accept, MFA enable/verify).

  `ctx.locale`'s fallback chain now checks the persisted `SessionUser.locale` (validated as a well-formed BCP-47 tag) between the live per-request signal (`X-Locale`/`Accept-Language`) and the app's boot-configured `defaultLocale` — so a user's chosen language now survives across devices and background/job contexts that carry no request-scoped locale signal.

  Silent server-side adoption of the live `ctx.locale` back onto `SessionUser` at login was considered and rejected: `ctx.locale` is already cascaded through the boot default by the time a handler sees it, so a login without an `X-Locale`/`Accept-Language` signal (curl, non-browser clients) would silently overwrite an explicitly-chosen locale. The existing `user:update` write path stays the sanctioned way to change a stored locale.

## 0.214.0

### Minor Changes

- 4e72848: Added a `unit` field formatter (`{ format: "unit", unit: "m2" | "km" | "m" | "kg" | "percent" }`) to `FieldFormatRegistry`/`applyFormatSpec`, so apps showing a value-with-unit on a detail page (e.g. `58 m²`) can declare `field.renderer` instead of hand-rolling an i18next `{{value}} m²` template. CLDR-sanctioned units (`km`/`m`/`kg`/`percent`) render locale-correctly via `Intl.NumberFormat({ style: "unit" })`; `m2` has no sanctioned ECMA-402 unit (`square-meter` throws `RangeError`), so it renders as a locale-formatted number with a literal `m²` suffix instead.

  `RenderField`'s readOnly + declared-`renderer` path (`FieldRendererOutput`) now also defaults `locale` to the app's `LocaleProvider` locale when the `FormatSpec` doesn't set its own — previously it silently fell back to the JS runtime's default locale for every locale-sensitive format (`timestamp`/`date`/`number`/`decimal`/`bigInt`/`unit`), not just the new one. An explicit `renderer.locale` still wins, same precedence as `dateLocale` vs. app-locale elsewhere in the same component.

## 0.213.0

### Minor Changes

- 7ffd0f6: The browser's active UI language now reaches the server. `createLiveDispatcher` reads `document.documentElement.lang` and sends it as an `X-Locale` header on every request; `createKumikoApp`/`createPublicSurface` keep that attribute in sync with the app's `LocaleResolver` via a new `DocumentLangSync` component, so this works in every app with zero app-side wiring.

  The server resolves the header (falling back to `Accept-Language`, then the app's boot-configured default locale, then `"en"`) into a new, always-present `ctx.locale` on `HandlerContext` — the same Request → Boot-Default precedence `ctx.tz` already uses.

  Every magic-link mail in the auth-email-password feature (signup, password-reset, email-verification, invite, account-unlock) now renders in the requester's active locale instead of a hardcoded boot-time default, and each flow's `appUrl` can now be a `(locale: string) => string` function so apps with language-prefixed paths can point the link at the right locale.

## 0.212.0

### Minor Changes

- 35b0005: `RowActionNavigate` (rowActions on entityList/projectionList, and header actions on projectionDetail) can now target an entity instead of a screen id: set `entity: "<entityName>"` instead of `screen`. The boot validator resolves it against the screen that declares `detailFor: "<entityName>"` (in any feature), the same way hand-written `nav.navigate({ entity, id })` calls already resolve via `resolveTarget`. `screen` and `entity` are mutually exclusive; `projectionList`/`projectionDetail` entity-targets require an explicit `entityId` field name since those rows have no guaranteed `id` field.

## 0.211.0

## 0.210.0

### Minor Changes

- 8b4467d: `projectionDetail`'s `hideActions: true` (0.209.0) hid RenderEdit's entire footer, including the screen's own declared `actions` — a screen that set `hideActions` to lose its Cancel button silently lost its header actions along with it (e.g. `RowActionNavigate` buttons opening related records).

  `projectionDetail` has no write path, so there's nothing for a Cancel button to discard: RenderEdit's `onCancel` is no longer wired up for this screen type at all, regardless of `listScreenId`. Back-navigation continues to work via the breadcrumb, which already resolved `listScreenId` independently. Declared `actions` now always render.

  **If you're on 0.209.0 and this affects you:**

  - Every existing `projectionDetail` screen with `listScreenId` set now renders without a Cancel button by default — that button used to show unless you opted out.
  - `hideActions` is removed from `ProjectionDetailScreenDefinition` entirely (it only ever shipped in 0.209.0, with the bundled sessions feature as its only consumer). Delete it from any screen definition that still sets it — it no longer exists on the type. `RenderEdit`'s own `hideActions` prop (for hosts driving their own action bar directly) is unrelated and unchanged.

- d85987c: PII field annotations collapse from twelve low-level flags (`pii`, `userOwned`, `tenantOwned`, `subjectRef`, `allowPlaintext`, `lookupable`, `searchable`, `sensitive`, `piiEncrypted`, ...) to two author-facing options: `personal` (whose data it is) and `find` (how it stays findable). No backward compatibility — the old flags are a type error now and every field definition must migrate.

  Before:

  ```ts
  email: createTextField({ required: true, pii: true, lookupable: true }),
  body: createLongTextField({ userOwned: { ownerField: "authorId" } }),
  ```

  After:

  ```ts
  email: createTextField({ required: true, personal: "self", find: "exact" }),
  body: createLongTextField({ personal: { of: "authorId" }, find: "none" }),
  ```

  `personal` picks the erasure subject, and with it the key whose destruction shreds the value: `"self"` (the row's own subject), `{ of: "<fieldName>" }` (someone else's data, keyed by that field), `"tenant"`, `"ref"` for a plain foreign key to a subject stored elsewhere, or `false` with a required `reason` for a field that looks sensitive but deliberately is not PII.

  `find` picks findability, and is mandatory on text fields once `personal` names a subject — forgetting it is what produced the drift this change removes:

  - `"exact"` — equality lookup over an HMAC blind index (`<column>_bidx`)
  - `"fuzzy"` — full-text search over the derived index, and equality on top
  - `"none"` — encrypted, not queryable
  - `"secret"` — never indexed, and stripped from the write-response echo. It is not a read gate: a detail query still returns the value, and who may see it remains `access: { read: [...] }`.

  `longtext` takes only `"none" | "secret"` — it has no field-level search index.

  `encrypted: true` is unchanged and orthogonal: an app-wide master key that stacks _on top of_ a subject key (as `userMfa.totpSecret` does), not an alternative to it. `piiEncrypted` is gone from entity fields; config keys keep their own.

  Fields that gain `"fuzzy"` where they previously had only `searchable` need a `_bidx` column — run `kumiko-schema generate` and let the projection rebuild backfill it. `scripts/codemod/pii-personal-migration.ts` migrates existing field definitions and reports anything it cannot map mechanically.

## 0.209.1

## 0.209.0

## 0.208.3

## 0.208.2

## 0.208.1

## 0.208.0

## 0.207.0

## 0.206.0

## 0.205.0

### Patch Changes

- 0aeb168: DataTable list columns of type `number`/`decimal`/`bigInt` now render locale-formatted via `Intl.NumberFormat`, matching how `timestamp`/`date`/`money` cells already behave. Previously they fell through to a raw `String(value)`, showing e.g. `245.5` with a dot even on a German-locale app while every other numeric column type used the locale's separator.

## 0.204.1

## 0.204.0

### Minor Changes

- 0d53fbd: `projectionDetail` screens can now declare a `relatedList` section (`layout.sections[]`, `kind: "relatedList"`) — a read-only list of related records that runs its own query, independent of the screen's own detail query. Fields: `title`, `query` (fully qualified QN, same paged envelope as `projectionList.query`: `{ rows, nextCursor, total? }`), `columns` (`ListColumnSpec[]`), optional `parentParam` (query-payload key the shown record's id is passed under, default `"id"`), optional `pageSize`, and optional `rowClick: { entity, idColumn? }`. A row click resolves its navigation target via `detailFor` (same lookup `resolveTarget` already uses for `ObjectTarget` navigation) — no `screenId` is named on the section itself.

  The boot-validator rejects: an empty/non-string `query`; a `rowClick.entity` with no screen anywhere declaring `detailFor` for that entity (error names the missing `detailFor` the same way `nav.ts`'s `resolveTarget` does); and a `relatedList` section inside a `mode: "wizard"` layout (a read-only list has no place in a stepped form). Extension sections remain rejected on `projectionDetail`, unchanged; `entityEdit`/`configEdit`/`actionForm` do not gain `relatedList` support.

  The renderer's `RelatedListSection` component (`@cosmicdrift/kumiko-renderer`, also usable standalone) fetches via the section's own query and renders through `RenderList` with no toolbar, search, sort, or pagination controls — deliberately out of scope for this section type. `@cosmicdrift/kumiko-headless`'s `EditSectionViewModel` gains the matching `EditRelatedListSectionViewModel` variant so `computeEditViewModel` can pass the section through to the renderer unresolved (the section runs its own query at render time, not at view-model-build time).

## 0.203.0

### Minor Changes

- 29e46a9: Screens can now declare `detailFor: "<entity>"` on `ScreenDefinition` to mark themselves as the detail view for that entity. A new boot-validator rule (`validateDetailForScreens`) rejects two screens declaring the same `detailFor` entity, and rejects a `detailFor` naming an entity no feature registers — apps that end up with either of those (e.g. after a rename) now fail at boot instead of silently misbehaving. Navigation targets can now be an `ObjectTarget` (`{ entity, id, workspaceId? }`) in addition to the existing `ScreenTarget` (`{ screenId, entityId?, workspaceId? }`) — `NavTarget` (exported from `@cosmicdrift/kumiko-renderer`) is now the union of both. The new `resolveTarget(features, target)` turns an `ObjectTarget` into a `ScreenTarget` by finding the screen whose `detailFor` matches, and throws if none exists. `useBrowserNavApi` resolves `ObjectTarget`s before building any path; callers that want `navigate`/`replace`/`hrefFor` to accept `ObjectTarget`s must pass the new `features` option (the app's `FeatureSchema[]`). Existing `ScreenTarget`-only call sites are unaffected. `formatPath` is now typed to accept `ScreenTarget` only — it never handled an `ObjectTarget`, so this is a type-only tightening.

  `projectionList` screens now wire search/sort/pagination state into their bound query the same way `entityList` screens do. `screen.searchable`, `screen.sortable` and `screen.paginated` are derived by `buildAppSchema` from the query handler's Zod schema (presence of `search`, `sort`, and `cursor`/`offset` params respectively) instead of being author-set — a hand-authored `sortable` or `paginated` on a `projectionList` screen now **fails boot** (`"sortable is derived from the query's Zod schema, don't set it"`), and `defaultSort` is now required as soon as search or sort is active. `searchable: true`/`false` set explicitly on the screen still wins over the derived default, and is still boot-validated against the schema as before. On the renderer side, `ProjectionListBody` now drives the URL-backed search box, sort headers and (pages-mode) pager into the query payload through the extracted `buildListQueryPayload` helper (also exported, and now shared with `EntityListBody` instead of each having its own inline payload construction) — previously a `projectionList` screen's query always received `{}` and ignored `searchable`/`defaultSort` at render time. Apps whose query handler accepts `sort`/`cursor`/`offset` params will start receiving those params on every request; handlers that don't inspect extra payload keys are unaffected.

- 437d3fb: `projectionDetail` screens can now declare header action buttons via a new optional `actions: readonly RowAction[]` field, reusing `RowAction` from `entityList`/`projectionList` — the screen's single displayed record stands in for the "row", so `pick`/`map` payload extraction, `visible`, `confirm`/`confirmLabel` and `style` keep their existing meaning. `rowClick` has no target on a detail screen (there is no row to click) and is rejected at boot with the screen QN and action id in the error. The existing rowActions/toolbarActions boot checks (navigate-target exists in some feature, writeHandler QN is registered, `params` only on targets that read it) now also cover `projectionDetail.actions`.

  When `screen.detailFor` names an entity, and some mounted feature (searched cross-feature via the app's full feature list, not just the projectionDetail's own feature) declares an `entityEdit` screen for that entity that the current user's roles can access, a default "Edit" action (`id: "edit"`) is prepended to the header actions automatically, navigating to that screen with the displayed record's id. A screen that declares its own action with `id: "edit"` in `actions` suppresses the default — the declared one wins, with no separate opt-out flag.

  `RenderEdit` (renderer) gains a new optional `actions?: readonly RenderEditAction[]` prop, rendered in the same header action-bar region as the existing copy-link/delete/cancel/save controls (before them, in array order) — no new action-bar region was added. Each action's `confirm`/`confirmLabel`/`style: "danger"` drive the same confirm-dialog behavior as `RowActionWriteHandler`. A declared navigate action without an explicit `entityId`, targeting an `entityEdit` screen for the `detailFor` entity, auto-fills the shown record's id so the target opens that record instead of a blank create-form — the same convention entityList/projectionList row actions already follow. When a header action's `onPress` throws, the error surfaces in the form's existing error banner region, not inside the action button row.

## 0.202.0

## 0.201.0

### Patch Changes

- aa3f669: `ctx.dbOutsideTransaction` is now fail-closed on `r.systemScope()` handlers, the same way `ctx.db` already was: touching it directly throws instead of handing back an unfiltered cross-tenant `TenantDb`. The guarded escape hatch is `ctx.systemDb.outsideTransaction`, a new pair of `assertTenantMatch(tenantId)` / `acknowledgeCrossTenant(reason)` methods mirroring the existing `ctx.systemDb.assertTenantMatch`/`acknowledgeCrossTenant`, but backed by the unbound-pool `dbOutsideTransaction` instead of the in-tx `db`.

  `UncheckedSystemDb` (`@cosmicdrift/kumiko-types`) gains a new required `outsideTransaction` member. `createUncheckedSystemDb`'s new second parameter is optional, so every existing call site keeps compiling unchanged; a hand-built `UncheckedSystemDb` object literal (none found in this repo) would need to add the new member. No handler currently reads `ctx.dbOutsideTransaction` directly on a `systemScope()`'d feature, so this closes a gap rather than fixing an active bug — but it is a real behavior change: the guard is a Proxy (truthy), so a bare `if (ctx.dbOutsideTransaction)` presence check on a system-scoped handler now passes and then throws on first property access, instead of silently handing back an unfiltered cross-tenant `TenantDb`.

## 0.200.1

## 0.200.0

## 0.199.2

## 0.199.1

## 0.199.0

### Minor Changes

- 8485e63: `HandlerContext` gains `systemDb?: UncheckedSystemDb` (fw#2067's fail-closed wrapper), populated for `r.systemScope()` handlers alongside the existing `ctx.db`. Non-system handlers don't receive it — `ctx.db` behavior is unchanged for everyone.

## 0.198.0

### Minor Changes

- 89ebe92: `NavDefinition.icon`, `ContentCollectionDefinition.nav.icon`, `ScreenNavSugar.icon` and `ConfigMask.icon` were all `icon?: string` — any typo (`icon: "seting"`) compiled fine and silently fell back to a dot in the sidebar. New `NavIconKey` union (`@cosmicdrift/kumiko-types/nav-icon`, re-exported from `@cosmicdrift/kumiko-framework/{engine,ui-types}`) types all four against the closed set of keys the web renderer actually registers, so an unregistered icon key is now a compile error at the `r.nav()`/`r.screen({ nav })`/config-mask call site instead of a missing icon at runtime.

  `packages/renderer-web`'s `NAV_ICONS` map is checked against the same union via `as const satisfies Record<NavIconKey, …>`, so the type and the map can no longer drift — adding a key requires updating both in the same change. This also surfaced a real pre-existing gap: `tenant-settings` declared `icon: "languages"`, which had never been a registered key (silently rendered as a dot); `languages` (lucide `Languages`) is now registered.

  This is a breaking type change for any app that passes an icon key outside the vocabulary in `packages/types/src/nav-icon.ts` — such a call site will fail to compile after this bump.

### Patch Changes

- 9b2c94a: `createKumikoApp`'s boot diagnostic (#2025) flagged every `type: "custom"` screen without a registered `clientFeatures` component as a missing client plugin — including screens that are dormant by design (registered without a self-owned `r.nav()`, meant to be navved by the consuming app itself, e.g. `user-data-rights`'s privacy center, `auth-mfa`'s enable screen, `personal-access-tokens`'s token screen). Added an optional `dormant?: boolean` field to `CustomScreenDefinition`; the diagnostic now skips screens flagged `dormant: true` instead of false-positiving on every app that hasn't wired the client plugin yet. Screens a feature self-navs (e.g. compliance-profiles' profile-picker) are unaffected and still trigger the diagnostic when their client plugin is missing — that stays a real bug (infra#503).

## 0.197.1

## 0.197.0

## 0.196.1

## 0.196.0

## 0.195.0

## 0.194.0

### Minor Changes

- 04f7a96: `ImageFieldDef` accepts `capture?: "environment" | "user"`, forwarded to the file input's `capture` attribute so a phone opens the camera instead of the file picker. Omitted by default, so existing image fields are unchanged.

  Not added to `ImagesFieldDef`: multi-image fields still have no widget (they render an "unsupported" banner), and a flag no renderer reads is the dead-flag state `thumbnails` was just removed for.

## 0.193.1

## 0.193.0

### Minor Changes

- 181003b: Image fields declare named derived versions: `createImageField({ variants: { profile: { fit: "cover", size: { width: 512, height: 512 }, format: "webp" } } })`. The specs are boot-validated, and `GET /api/files/:id/variant/:name` serves them behind the same tenant + access guard as the download — a request carries only a NAME, never a spec, so no caller can drive an arbitrary render. The edit-form preview loads the first declared variant instead of the original.

  BREAKING: `ImageFieldDef.thumbnails` / `ImagesFieldDef.thumbnails` are removed. The flag was never read by anything; `variants` is what it pointed at.

## 0.192.0

### Minor Changes

- 58505c6: New `derivatives-sharp` feature: server-only image renderer that registers at the `derivativeRenderer` extension point for `image/*`. Resize (cover/inside/contain), format conversion with quality (webp/avif/jpeg), whole-image blur and `blurRegions` for burning blur into plates or faces. EXIF orientation is applied, all other EXIF (including GPS) is dropped. `blurRegions` is part of `VariantSpec`, so corrected regions hash to a fresh variant URL instead of serving a stale cache hit.

## 0.191.0

## 0.190.0

## 0.189.0

### Minor Changes

- 64c5f92: **BREAKING:** `type:"date"` fields (`createDateField`) now back onto a real Postgres `DATE` column and round-trip as `Temporal.PlainDate`, fully decoupled from `Temporal.Instant`/`TIMESTAMPTZ` (kumiko-framework#1924). Previously `date` was silently aliased onto the same `instant()`/`TIMESTAMPTZ` column as `type:"timestamp"`: reads returned a full ISO instant (`"2026-03-15T00:00:00Z"`), writes expected a bare `"yyyy-mm-dd"` string that got bound to a timestamptz column through the session's TimeZone — so both directions were timezone-dependent for what is meant to be a pure calendar-day value (invoice date, lease term).

  After this change:

  - **Read shape**: a `date` field now serializes as `"2026-03-15"` (via `Temporal.PlainDate`'s own `toJSON()`), not `"2026-03-15T00:00:00Z"`. Any non-form client that Instant-parses a date field's JSON value (`Temporal.Instant.from(value)`) will throw — that parse requires a UTC designator/offset a PlainDate string doesn't have. A client that only reads the leading `"yyyy-mm-dd"` (string slice, or the existing form-fill path) is unaffected, since both old and new values share that prefix.
  - **Write shape**: unchanged — `date` fields already took a bare `"yyyy-mm-dd"` string; that now binds directly to a real `DATE` column instead of drifting through the session TimeZone on the way into a `TIMESTAMPTZ` column.
  - **Where-filters**: a filter value built as a `Temporal.Instant` against a `date` column (a leftover pattern from when `date` was an Instant alias) still works — `prepareValue` anchors it at UTC before binding — but new code should build `date` filters as plain `"yyyy-mm-dd"` strings or `Temporal.PlainDate`.

  **Migration, per entity's table kind:**

  - **Managed (event-sourced projection) tables**: the generator emits `DROP TABLE` + `CREATE TABLE` and replays from the event log — no manual SQL needed, but factor in the replay cost for entities with a large event history.
  - **Unmanaged (`store_*`, direct-write) tables**: the generator emits an in-place `ALTER TABLE … ALTER COLUMN … TYPE date USING (col AT TIME ZONE 'UTC')::date` for exactly this `timestamptz → date` transition — anchored explicitly at UTC. A bare `ALTER COLUMN … TYPE date` (no `USING`) falls back to Postgres's implicit cast, which reads the _session_ TimeZone and can migrate the same row to a different calendar day depending on who runs it; do not hand-write that fallback form.

  No consumer-repo migration is included in this PR — solon has ~15 `type:"date"` fields on unmanaged tables and needs its own migration + existing-data audit as a follow-up.

- 833c4f7: `redirect` (actionForm, entityEdit) and `cancelTarget` (actionForm) now also accept a fully-qualified cross-feature screen QN (`<feature>:screen:<id>`), in addition to the existing same-feature short screen-ID. Boot-validator resolves the QN directly against all registered screens; the renderer strips it to the short id before navigating, since the runtime router already resolves bare short ids app-wide. Short IDs keep their unchanged same-feature behavior (kumiko-framework#1946).

### Patch Changes

- 321b375: `entityEdit` screens now support `redirect?: string`, mirroring `actionForm`'s field: navigate to this same-feature screen ID after a successful save (create or update) instead of the default "back to the entity's list" target. Boot-validator checks the ID resolves to a registered screen, same as `actionForm.redirect`. Delete is unaffected — it still always navigates to the list.
- d0f03f9: `entityEdit` screens now support `singleton: true` for entities with exactly one record per tenant (organization, settings, tenant profile). A call without an `entityId` resolves the existing record via `<entity>:list` (limit 1) and renders the update branch with prefill on a hit, instead of always rendering an empty create form — so a declarative nav entry can point straight at a singleton edit screen without a wrapping entityList-with-one-row workaround. The create branch (and `allowCreate: false`) still applies when the table is empty.

## 0.188.0

### Patch Changes

- e55c957: Raise the hono peer range to ^4.13.1 so consumers no longer resolve 4.12.x builds affected by the JSX context-isolation, memo() and cx() advisories.

## 0.187.0

## 0.186.3

## 0.186.2

## 0.186.1

## 0.186.0

## 0.185.0

### Minor Changes

- 0a059a0: `createEmbeddedListField()` now has an editable widget, so line-item forms (invoices, bookings, orders) can be declared instead of hand-built as a custom screen. The field type gains `select`/`reference` cell types, `minItems`/`maxItems` bounds, derived cells (`multiply`/`sum`/`subtract`), and column totals; the new `EmbeddedListInput` renders it as a controlled table/card with add/remove/duplicate/reorder, keyboard navigation, and paste-from-spreadsheet support (fw#1838).

### Patch Changes

- 43e0291: Embedded-list widget follow-ups from #1838 review (fw#1839):

  - Keyboard focus after Tab/Enter-to-add-row now lands on the actual focusable control (date/timestamp/money/select/reference cells), not the non-focusable wrapper `div`; Enter on the last cell now also appends+focuses a new row, mirroring Tab.
  - Embedded-list money cells and the totals row use the entity's `defaultCurrency` instead of a hardcoded `"EUR"`.
  - Reference sub-fields inside an embedded field get the same boot-time target-entity/labelField/list-query-handler checks as top-level reference fields.
  - New declarative `totalsMatch` on `EmbeddedFieldDef` validates (client and server, via the same Zod schema) that the sum of a list subfield equals a sibling top-level money field, with boot-time checks that both fields exist and are money-typed.
  - New `"timestamp"` embedded-list cell type, end to end (types, schema validation, view-model, renderer primitives, `TimestampInput` in the web renderer).
  - Derived embedded-list cells (`field.derived`) are now re-validated server-side against a local mirror of the client's `computeDerivedCellValue`; an absent derived cell is never flagged as a mismatch against 0.

## 0.184.0

## 0.183.2

## 0.183.1

## 0.183.0

### Minor Changes

- 08c5c8c: `ContentCollectionDefinition.variableSchema` now maps each variable name to an example value (e.g. `{ customerName: "Max Mustermann" }`) instead of an unused placeholder. The renderer gets `ContentPreview` + `substituteVariables`: a read-only render of the collection's registered editor with `{{name}}` replaced by its example value, same mechanic for every `contentFormat` since it reuses the very component the collection edits with. `template-resolver`'s content-collection editor gets a Preview toggle next to the content field.

## 0.182.1

## 0.182.0

### Minor Changes

- 8a3b0a9: `r.contentCollection()` accepts a new `contentFormat: "plain" | "rich"` field. `ClientFeatureDefinition` gets a sixth registry, `contentEditors` — a `contentFormat → EditorComponent` map merged with the same last-wins semantics as `columnRenderers`. `createKumikoApp` mounts a `ContentEditorsProvider`; `useContentEditor(contentFormat)` resolves the registered component or falls back to a plain textarea, so a missing editor is never an empty panel. `template-resolver`'s content-collection editor now renders through this registry instead of a hardcoded textarea.
- 9c62bc8: `ContentCollectionDefinition` accepts a new `variableSchema` field — fixed variable names the app declares for a collection (e.g. an `ai-prompt` collection's `{customerName}`, `{orderId}`). The renderer gets `VariableChips`, an editor-agnostic chip bar that inserts `{{name}}` at the caret on click, and `renderer-web` gets `PlainContentEditor`, which pairs it with the existing textarea fallback. `template-resolver`'s client now registers `PlainContentEditor` under `contentEditors.plain` and passes the collection's variable names through, so AI-prompt and mail-html collections with `contentFormat: "plain"` get the chip bar without any app-side wiring.

## 0.181.0

## 0.180.0

## 0.179.0

## 0.178.1

## 0.178.0

## 0.177.0

## 0.176.2

### Patch Changes

- 63b6acf: PR-review fix batch (low-severity findings):

  - `FIELD_ICONS`/`NAV_ICONS` lookups now check `Object.hasOwn` — a `icon: "constructor"`/`"toString"` key no longer resolves through the prototype chain into a render crash.
  - `subjectRef` narrowed to `?: true` (no observed `false` usage) — matches the sibling `lookupable?: true` idiom.
  - `sse-broker`'s access-invalidation listener Set now documents its callback-reference dedup contract.
  - `date-parse.ts`'s `toIso` passes `calendarName: "never"` so a future non-ISO `PlainDate` can't leak a `[u-ca=...]` suffix onto the wire.
  - `runRunner` (gen-feature-screenshots) wipes each scenario's output dir before a fresh Playwright run — a renamed/removed scenario no longer leaves a stale preview behind.
  - `screenshots.ts`'s `axis()` throws instead of silently registering zero tests when an env filter matches nothing.
  - `run-prod-app`'s `extraRoutes` now mount before seeds/seed-migrations (previously after `entrypoint.start()`), matching the dev-server's ordering — a seed that dispatches through the Hono matcher no longer blocks a later `extraRoutes` route registration.
  - `job-runs-screen`'s job selector now resets payload/error/success state on job change, instead of validating stale payload text against the newly selected job's schema.
  - `render-field`'s create-then-refetch clears the stale search term first and logs (instead of swallowing) a refetch failure.
  - `purge-subject.ts`'s per-entity SELECT is now paged (batch 500, like `reindexEntity`) instead of pulling a whole tenant table into memory.
  - `login.write.ts`'s `gateResolveAuthUser`/`gateVerifyPassword` now share a narrowed `AuthenticatableUserRow` type — removes a redundant, differently-timed second `passwordHash` miss path.
  - `dispatch-shared.ts`'s `tenant:config:timezone` literal is now a named constant, with a new integration test booting the real `createTenantFeature()` to catch drift (previously only a standalone probe feature exercised it).
  - `NotifyOptions.recipientId`'s JSDoc now states it's ignored on the `to` path.
  - Test fixes: `access-roles`/`boot-validator` tests silence `console.warn` instead of letting it print during the run; `tz-resolution.integration.test.ts`'s third case sets its own tenant-config precondition instead of relying on test order; `jobs-catalog.integration.test.ts` now uses `setupTestStack` + real HTTP like its sibling suite instead of hand-rolled fetch helpers; a `styleguide`/`renderer` test-only `as unknown as` cast replaced with a typed optional + `delete`.

## 0.176.1

## 0.176.0

## 0.175.0

## 0.174.1

## 0.174.0

## 0.173.1

## 0.173.0

## 0.172.0

## 0.171.2

### Patch Changes

- c717af3: `NotifyOptions` gains an optional `recipientId` for the `route` (direct, no-user-account) delivery path. Previously `route:{email}` sends always logged `recipientId: null` in the delivery-attempt event, so `recipientAddress` (piiFields subject = recipientId) had no subject key to encrypt under and stayed plaintext. Callers without a user account (e.g. a share-token recipient) can now pass `recipientId` to tie the logged address to a crypto-shredding subject.

## 0.171.1

## 0.171.0

### Minor Changes

- 32123ff: `entityEdit`/`configEdit`/`actionForm`/`projectionDetail` screens can now set `layout.width` ("sm" | "3xl" | "4xl" | "full") to opt out of the hardcoded 3xl-centered form shell — useful for dense multi-column masks that previously left dead space on both sides (#1676). Unset stays "3xl" (unchanged default).

## 0.170.0

## 0.169.0

### Patch Changes

- 644274a: Fix `preSave` hooks being a silent no-op (#1672). `r.hook("preSave", ...)` was registered and boot-validated, but no dispatch path ever ran it — only `postSave`/`preDelete`/`postSaveBatch` were wired.

  `preSave` now runs for entity CRUD `create`/`update` handlers (`r.crud(...)`, `defineEntityCreateHandler`/`defineEntityUpdateHandler`), transforming `changes` before persistence and before ownership checks (authorization evaluates the final, hook-shaped row). Register per verb — there is no `{ allOf }` shorthand for `preSave` since create/update are separate handlers:

  ```ts
  r.hook("preSave", "contact:create", deriveDisplayName);
  r.hook("preSave", "contact:update", deriveDisplayName);
  ```

  Scope: only entity CRUD handlers that go through the event-store executor get this automatically. A fully custom `r.writeHandler` that doesn't call the executor must invoke `ctx.runPreSave(...)` itself.

## 0.168.0

### Minor Changes

- 4c7d3c9: `r.crud`/`registerEntityCrud` gain `verbAccess?: Partial<Record<EntityCrudVerb, AccessRule>>` to gate individual verbs (e.g. `delete`/`restore`) more strictly than the shared `write`/`read` access rule. Resolution per verb: `verbAccess?.[verb] ?? (isWrite ? write?.access : read?.access)`. Existing calls without `verbAccess` are unchanged.

## 0.167.1

### Patch Changes

- cf5302a: `ctx.tz.tenant`/`ctx.tz.user` no longer hardcode `"UTC"` — `tenant` now reads the `tenant:config:timezone` config key (via the already-wired `ctx.config` accessor, falling back to `"UTC"` when unset or no config feature is mounted) and `user` reads the new `SessionUser.timezone` field (set at login, falling back to `tenant`). `SessionUser` gains an optional `timezone` field, carried through the signed JWT (`JwtPayload.timezone`) the same way `roles` is (kumiko-framework#1636).

  `buildHandlerContext` (exported from `@cosmicdrift/kumiko-framework/pipeline`) is now `async` — it was previously synchronous. Direct external callers (not the normal dispatch path, which already awaits it) need to add `await`.

## 0.167.0

### Minor Changes

- 57c1da2: `packaging`: the six identity-sensitive error classes moved out of `@cosmicdrift/kumiko-types` into `@cosmicdrift/kumiko-framework` — `VersionConflictError`, `IdempotentAppendConflictError` and `ArchivedStreamError` to `/event-store`, `KeyErasedError`, `KeyNotFoundError` and `KeyAlreadyExistsError` to `/crypto`. Those are the public paths callers already import from, so nothing moves for consumers; the `@cosmicdrift/kumiko-types/event-store-errors` subpath is gone.

  With no classes and no local `Symbol()` left in it, `kumiko-types` no longer needs the single-copy guarantee a peerDependency buys, and framework/bundled-features declare it as a plain dependency. That closes the changesets cycle where a peer-dependent bump escalated every minor release to `1.0.0`.

### Patch Changes

- ce30a2c: `deps`: hono range raised to `^4.12.27` — the floor that carries the fixes for three advisories on the production HTTP layer: cross-request data disclosure in `hono/jsx` (context not isolated per request), server-side XSS via a JSX escaping bypass in `cx()`, and a dropped repeated request header in the API-Gateway v1 adapter. The old `^4.12.18` allowed the patched versions but the lockfile sat on 4.12.25, so the range now states the security floor instead of relying on resolution luck.
- 8647246: `secrets`: `SecretBrand` uses `Symbol.for("kumiko.secret")` instead of a per-copy `Symbol()`. Two resolved copies of the package branded with two different symbols, so `createSecret()` from one and `isSecret()` from the other disagreed — and `isSecret()` is the only check `assertNoSecretLeak` has, so the response-leak guard walked past the value and serialized the plaintext. Matches the `Symbol.for` treatment the schema symbols already use (#1632).

## 0.166.0

## 0.165.4

## 0.165.3

### Patch Changes

- e4a0b9b: Allow `searchable` on subject-annotated PII: decrypt into the derived Meili index and purge docs on Art.17 erase (fw#1610).

## 0.165.2

### Patch Changes

- ed36555: Rename `buildEntityTableMeta` → `deriveEntityTableMeta` so the helper is not mistaken for the unmanaged escape hatch (`defineUnmanagedTable`). Deprecated alias kept. Unmanaged builders now reject the reserved `read_` table-name prefix (#1208/#1220).

## 0.165.1

## 2.0.0

### Major Changes

- eb856c6: Fixes a batch of code-review findings across kumiko-framework/bundled-features/types (PR#1222/1501/1431/1529/1333/1461/1424/1439/1423/1337/1398/1252/1257/1489/1472/1452/1545/1543/1547/1549/1551).

  **Breaking:**

  - `makeAuthGate(LoginComponent, loginProps, MfaVerifyComponent, MfaSetupComponent)` and `makeSessionAuthGate(...)` (`@cosmicdrift/kumiko-bundled-features/auth-email-password`) now take a single `LoginRouteOptions` object instead of four positional args — the positional signature didn't scale past two optional MFA params. Update call sites to `makeAuthGate({ loginScreen, loginScreenProps, mfaVerifyScreen, mfaSetupScreen })`.

  **Fixes (non-breaking):**

  - `document-ingest-foundation`'s `documentExtractEntity.pages` column is now `encrypted: true` (stored as serialized JSON in an encrypted `longText` column instead of plaintext `jsonb` — the underlying Postgres column type changes from `jsonb` to `text`) — it held the full extracted text of ingested documents (invoices, IDs, contracts) in plaintext. Apps mounting this feature now need an entity-field-encryption master key configured (same requirement every other PII-encrypted field already has) if they don't already have one. No migration needed: this entity has no writer yet (`#1497` unlanded), so no app has persisted rows against the old `jsonb` shape.
  - `reindexEntity()`'s `ReindexEntityResult` gains `wouldIndexRows` — a dry run no longer inflates `indexedRows` (which now stays 0 when nothing was written); also now reports a `failures` entry instead of silently indexing a partial document when a searchable field can't be mapped from the read-table row.
  - `UserDataDeleteHook`'s return type now includes bare `void` in the union (previously only `undefined`), so a hook explicitly typed `Promise<void>` (not just a contextually-typed arrow literal) type-checks again.
  - `run-forget-cleanup` write-handler's response now includes `incompleteCount`/`incomplete` so operator tooling can see partial-deletion hook results, not just hard failures.
  - tenant `invitations`/`members` query handlers: bounded-concurrency (pool-limit 4) PII decrypt instead of a strict sequential loop, and `invitations` no longer decrypts `invitedBy` (a plain userId, never PII-encrypted at write time).
  - `packages/framework/src/db/dialect.ts`'s `KUMIKO_NAME_SYMBOL`/`KUMIKO_COLUMNS_SYMBOL`/`KUMIKO_META_SYMBOL` are now imported from `@cosmicdrift/kumiko-types/schema-table-types` everywhere internally instead of being re-declared per call site — `SchemaTable` now also carries `[KUMIKO_META_SYMBOL]`.
  - `peerDependencies["@cosmicdrift/kumiko-types"]` changed from `workspace:*` to `workspace:^` in `kumiko-framework`/`kumiko-bundled-features` (a staggered-bump consumer previously got two unresolvable exact peer pins); removed the no-op `peerDependenciesMeta.optional: false`.
  - `request-helper`'s `authHeader()` now caches one session id per `(user.id, tenantId)` instead of per `user.id` alone — the same user id holding sessions in two tenants previously got handed the wrong tenant's cached sid.
  - `auth-foundation`'s anonymous-access tenant-resolver/tenant-exists merge no longer casts through `as TenantResolver`/`as TenantExists` — the underlying function types were already structurally compatible.
  - `isSafeHref` (`@cosmicdrift/kumiko-headless`) now decodes HTML character references (`&colon;`, `&#58;`, `&Tab;`, `&#9;`, ...) before its scheme check — `javascript&colon;alert(1)`/`java&Tab;script:alert(1)` previously slipped through because neither contains a literal `:` for the pre-decode regex, but the browser decodes the entity back into an executable `javascript:` URL on click. Affects `renderSafeMarkdown` (page-render) and the renderer-web `Link` primitive.
  - `user-data-rights`'s `restrict-account` write-handler now runs the same cross-tenant membership check as `lift-restriction` — previously any Admin/TenantAdmin (not just SystemAdmin) could restrict a user's account and force-revoke their sessions regardless of tenant, as long as they held an admin role in _some_ tenant.
  - `dispatch-shared.ts`'s `runStreamInstrumented`: a close-time error from `generator.return()` (e.g. a handler's `finally` failing to release a cursor/unsubscribe) is now folded into the dispatcher error metric and span status when nothing else already failed, instead of being silently discarded; also drops the unused/untested `it.throw()` forwarding branch (no production caller ever calls `.throw()` on a dispatcher stream).
  - `event-store.ts`'s `ensureIdempotencyKeyIndex` re-verifies the index is actually valid before treating a caught error as a benign concurrent-build race — a `lock_timeout` during `CREATE INDEX CONCURRENTLY` (55P03) was being misclassified as "the other pod already built it", silently leaving the idempotency-key uniqueness unenforced.
  - `routes.ts`'s SSE `pumpStream`'s finally block and the pre-pull client-abort path no longer `await generator.return(undefined)` — V8 queues that call behind an in-flight `.next()`, so awaiting it could hang the response indefinitely if the handler's pull never settles (e.g. a dead Redis/DB subscription after a client disconnect). Now fire-and-forget, matching the existing `stream.onAbort()` handler's style (which was already fire-and-forget).
  - `reindexEntity()` now fails fast with one clear error when a searchable field has no matching read-table column (dropped/never-migrated schema), instead of pushing one identical `failures[]` entry per scanned row.
  - `user-data-rights`'s GET `/user-export/by-token?token=` fallback now forwards `x-forwarded-for` to the internal `/api/query` call the same way the POST fragment-exchange route already does — previously every legacy magic-link download collapsed onto request-id-middleware's own (empty/localhost) IP, turning `download-by-token`'s per-IP 30/min rate limit into a single global bucket shared by every user (self-inflicted 429s). Also logs a warning on each hit so ops can see when it's safe to remove (kumiko-framework#1562).

  **Missed changesets (retroactively documented, already merged in #1547):**

  - `pumpStream`'s exported signature changed: `firstOutcome?: IteratorResult<unknown>` → `firstPull?: Promise<IteratorResult<unknown>>`.
  - `validateSessionStoreMultiplicity` no longer throws on zero registered `sessionStore` providers — a pure machine-API deployment (PAT-bearer auth only, no browser sessions) can now mount `auth-foundation` without also mounting `sessions`.
  - New public exports: `StreamFrame` (`kumiko-framework`/`-headless`), `isToggleableFeature` (`kumiko-framework`), `parseSseFrames`/`parseSseBlock`/`iterateSseChunks` (`kumiko-dispatcher-live`).

### Patch Changes

- c58f20f: `NumberFieldDef` / `createNumberField` accept optional `max` (mirrored from `min`); schema-builder applies Zod `.max()` at the write boundary so integer CRUD can reject values that would overflow Postgres `integer` (#1573).

## 1.0.0

### Patch Changes

- 53f83f5: `@cosmicdrift/kumiko-types` moves from a plain `dependency` to a `peerDependency` of both `@cosmicdrift/kumiko-framework` and `@cosmicdrift/kumiko-bundled-features` (kumiko-framework#1438).

  **Why:** `@cosmicdrift/kumiko-types` ships identity-sensitive runtime error classes (`VersionConflictError`, `ArchivedStreamError`, `KeyErasedError`, `KeyNotFoundError`, `KeyAlreadyExistsError`) despite its description previously claiming "no runtime code". If a consumer app installs `@cosmicdrift/kumiko-types` directly at a different version than the one framework/bundled-features resolve internally, `instanceof` checks against these classes silently return `false` across the two copies — a `catch (e) { e instanceof VersionConflictError }` in your app code would miss errors thrown from framework's own copy. Declaring it as a peer dependency forces a single resolved copy across the dependency tree instead of silently tolerating two.

  **Consumer action:** if your app doesn't already list `@cosmicdrift/kumiko-types` as a direct dependency, no action needed — `bun install` resolves the peer automatically from what framework/bundled-features already pull in (verified empirically in this repo's own workspace: `bun install` after this change reported 0 peer-dependency warnings). If you do list it directly (e.g. to build against its type contracts without the full framework import), pin it to the same version as your `@cosmicdrift/kumiko-framework`/`@cosmicdrift/kumiko-bundled-features` release.

## 0.165.0

### Minor Changes

- cf56745: Removes dead public API with zero verified consumers across all Kumiko repos:

  - `@cosmicdrift/kumiko-framework`: `getUnscopedAggregateStreamTenant` (event-store), `createEncryptionProvider`/`EncryptionProvider` (legacy single-key db encryption, superseded by `createEnvelopeCipher`), and the unused `tx` parameter on `executeStream`/`dispatcher.stream()`.
  - `@cosmicdrift/kumiko-types`: `ConfigResolver.getAllWithSource` and the corresponding resolver implementation.
  - `@cosmicdrift/kumiko-dispatcher-live`: `SseFrame`, `iterateSseChunks`, `parseSseFrames` re-exports (internal consumers already import from `./sse-stream` directly).
  - `@cosmicdrift/kumiko-dev-server`: `IdentityStackOptions.providers` (never wired by any app — provider features are appended positionally instead; `GdprStackOptions.providers` is unaffected, it has real callers/tests).

  Adds `toInstant` to `@cosmicdrift/kumiko-headless`'s public barrel (previously an unexported helper duplicated by `@cosmicdrift/kumiko-renderer`'s `formatWhen`).

## 0.164.0

### Minor Changes

- 90b4221: `EventMetadata` gains an optional `idempotencyKey`. When set, `append()` enforces it via a tenant-scoped partial unique index (`metadata->>'idempotencyKey'`) and throws the new `IdempotentAppendConflictError` on a repeat — a second line of defense against duplicate appends when the Redis-backed HTTP idempotency guard misses a retry window. Opt-in only; existing callers are unaffected.

## 0.163.3

## 0.163.2

## 0.163.1

## 0.163.0

## 0.162.0

## 0.161.0

## 0.160.0

## 0.159.1

### Patch Changes

- 6d37eb5: `FileContext`/`FileHandle` move from `packages/framework/src/files/file-handle.ts` to `@cosmicdrift/kumiko-types/file-handle-types`. The old path stays a re-export, so no internal import site changes. `FileStorageProvider` (from `files/types.ts`) is unrelated to these two types and stays put.

## 1.0.0

### Patch Changes

- d0280c8: `@cosmicdrift/kumiko-types` gains its first real content: `identifiers`, `target-ref`, `event-type-map`, and `http-route` move out of `packages/framework/src/engine/types/`. The old paths stay as re-export shims, so no internal import site changes. Framework now depends on `@cosmicdrift/kumiko-types` for these.
- a997cc8: `relations` and `tree-node` move from `packages/framework/src/engine/types/` to `@cosmicdrift/kumiko-types`. The old paths stay as re-export shims, so no internal import site changes.
