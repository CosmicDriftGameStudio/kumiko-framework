# @cosmicdrift/kumiko-locale-es

## 0.255.1

### Patch Changes

- Updated dependencies [5b04527]
  - @cosmicdrift/kumiko-framework@0.255.1

## 0.255.0

### Patch Changes

- Updated dependencies [88530a2]
- Updated dependencies [0374846]
- Updated dependencies [1212eeb]
- Updated dependencies [7003472]
  - @cosmicdrift/kumiko-framework@0.255.0

## 0.254.0

### Patch Changes

- Updated dependencies [9b74bc9]
  - @cosmicdrift/kumiko-framework@0.254.0

## 0.253.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.253.0

## 0.252.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.252.1

## 0.252.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.252.0

## 0.251.0

### Patch Changes

- Updated dependencies [55691fd]
- Updated dependencies [28ad1f3]
  - @cosmicdrift/kumiko-framework@0.251.0

## 0.250.0

### Patch Changes

- Updated dependencies [86e18dd]
- Updated dependencies [a4a25ee]
- Updated dependencies [e349f03]
- Updated dependencies [0be08d9]
- Updated dependencies [d9f9337]
- Updated dependencies [5c1c606]
  - @cosmicdrift/kumiko-framework@0.250.0

## 0.249.0

### Patch Changes

- Updated dependencies [812795d]
  - @cosmicdrift/kumiko-framework@0.249.0

## 0.248.0

### Patch Changes

- Updated dependencies [109ff0d]
  - @cosmicdrift/kumiko-framework@0.248.0

## 0.247.0

### Minor Changes

- 25cbdd2: fw#2722 (remaining scope — Card-Rahmen already shipped separately): a `relatedList` section can now sort and no longer stretches the page.

  **Sorting.** `ListColumnSpec` gains a `sortable?: boolean` flag and `EditRelatedListSection` gains `defaultSort?: ListSortSpec` — declared per-column, the same shape `entityList.defaultSort` uses, and validated the same way at boot (`defaultSort.field` must name a listed, `sortable: true` column, or the app fails to boot). Both are opt-in: a `relatedList` section that declares neither behaves exactly as before.

  Sorting is applied **client-side**, over the rows already loaded for the section. Unlike `entityList`/`projectionList`, a `relatedList` section has no pager at all — one one-shot fetch, no cursor, no `onReachEnd`. When the server-side `limit` truncates that fetch (`PagedRows.nextCursor !== null`), the loaded rows are only the first page in the server's own order, not "the top N by this column" — sorting that subset client-side would otherwise silently misrepresent it as the latter. `RelatedListSection` now renders an info `Banner` above the table whenever `nextCursor !== null`, independent of whether a sort is active, naming how many rows are shown (`kumiko.list.related-list-truncated`, added to `i18n-defaults.ts` and the `locale-de`/`locale-es` packages). Sending the sort to the server instead would need pagination this section doesn't have, so it was not built for this PR.

  **Height.** A `relatedList` section in a tabs-mode Akte (the layout that already hides the section title, `hideSectionTitles: true`) now fills the tab panel's available height and scrolls its table internally, instead of a fixed `60vh` guess or growing the whole page — the concrete complaint (a 40-row Akte tab pushing the page and making the record unusable, on any viewport height) is fixed. `FormProps` gains a `fillHeight` flag; `RenderEdit` sets it only when tabs mode has narrowed the form to a single, active `relatedList` section (`hideSectionTitles === true && filteredSections[0]?.kind === "relatedList"`) — every other form (multi-section, non-`relatedList` tabs, stacked non-tabs forms, `entityList`/`projectionList`) is untouched. The flag threads a `flex-1 min-h-0` chain from `FormRoot` through `FormScreenShell`, the form's card, `RelatedListSection`'s own wrapper, down to `DataTableProps.scrollBody`'s table body (now `flex-1 min-h-0 overflow-y-auto` instead of `h-[60vh] overflow-y-auto`) — the narrow-viewport card list (`scrollBody`'s `cardsInner()` branch) gets the same `flex-1 min-h-0 overflow-y-auto` treatment so it scrolls internally instead of clipping. No change to `app-layout.tsx`/`DefaultAppShell` was needed: `<main>` is already viewport-bounded with a passive `overflow-auto`, so a child that itself never grows past `<main>`'s available height never triggers it — avoiding nested scrollbars without touching shell code shared by every screen. This depends on the shell's `fill` prop staying at its default `true` (an app-level choice, not per-screen); `fill={false}` is an explicit page-scroll escape hatch that leaves `<main>` height-unbound, so the chain degrades gracefully to the pre-fix, unbounded-growth behavior rather than clipping — grepped across every consuming app repo in the workspace, none currently sets `fill={false}`.

  `@cosmicdrift/kumiko-renderer` stays platform-neutral (no DOM/Tailwind), so the terminal link of this chain — the wrapper around `RelatedListSection`'s `hideTitle` content — can't be a raw `<div>`. `CorePrimitives` gains an optional `FillContainer` primitive (same additive-rollout pattern as `JsonView`/`Drawer`/`Progress`: existing partial `CorePrimitives` test doubles keep compiling), implemented in `renderer-web` as the `flex-1 min-h-0 flex-col` div; `RelatedListSection` falls back to rendering its content unwrapped when a host has no `FillContainer` (e.g. a native impl, where the parent is already a bounded viewport and the wrapper is meaningless).

  Not included: search/facets on `relatedList` (`ListFacetSpec`, as `projectionList` has it). Doing this properly would mean replacing `RelatedListSection`'s synthetic minimal entity (a `{ type: "text" }` field per column, with no real query-schema/facet metadata behind it) with genuine reuse of the `projectionList` path — a structural rebuild out of scope for this PR. Left for a follow-up ticket.

  https://claude.ai/code/session_0135cRvFdyV956Aae8PxyyDd

### Patch Changes

- Updated dependencies [25cbdd2]
- Updated dependencies [f9f5608]
  - @cosmicdrift/kumiko-framework@0.247.0

## 0.246.0

### Patch Changes

- Updated dependencies [b4d5b20]
- Updated dependencies [f2c9178]
  - @cosmicdrift/kumiko-framework@0.246.0

## 0.245.0

### Patch Changes

- Updated dependencies [3359dae]
  - @cosmicdrift/kumiko-framework@0.245.0

## 0.244.0

### Patch Changes

- Updated dependencies [2cb949e]
- Updated dependencies [dc4e6a2]
  - @cosmicdrift/kumiko-framework@0.244.0

## 0.243.4

### Patch Changes

- @cosmicdrift/kumiko-framework@0.243.4

## 0.243.3

### Patch Changes

- @cosmicdrift/kumiko-framework@0.243.3

## 0.243.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.243.2

## 0.243.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.243.1

## 0.243.0

### Patch Changes

- Updated dependencies [349d763]
  - @cosmicdrift/kumiko-framework@0.243.0

## 0.242.0

### Patch Changes

- Updated dependencies [efd5891]
  - @cosmicdrift/kumiko-framework@0.242.0

## 0.241.0

### Patch Changes

- Updated dependencies [8289b69]
  - @cosmicdrift/kumiko-framework@0.241.0

## 0.240.0

### Patch Changes

- Updated dependencies [db53bbc]
  - @cosmicdrift/kumiko-framework@0.240.0

## 0.239.0

### Patch Changes

- Updated dependencies [2fbab3d]
  - @cosmicdrift/kumiko-framework@0.239.0

## 0.238.0

### Minor Changes

- 8206493: `ListColumnSpec` gains optional `refEntity`/`refLabelField` fields so `projectionList`/`relatedList` columns can declare a reference lookup — those screens have no `EntityDefinition` to carry a real `reference` field type, so a declared reference column previously rendered the raw id. `computeListViewModel` now checks this metadata before the entity-fields lookup and marks the column as `type: "reference"`; the existing renderer-side bulk lookup (`useReferenceLookup`) picks it up automatically.

  `delivery-log`'s `tenantId` column and `sessions-list`'s `userId` column now declare this metadata and resolve to the tenant/user display name instead of the GUID. `useReferenceLookup` also gained a generic fallback (`SYSTEM_REFERENCE_LABELS`, keyed by `refFeature:refEntity`) for reference ids that have no backing row — currently covering `SYSTEM_TENANT_ID`, which renders as the new `kumiko.reference.system-tenant` ("System") label instead of the all-zero GUID.

  `EditFieldSpec` gains the same `refEntity`/`refLabelField` metadata for `projectionDetail` fields, resolved by `computeEditViewModel` with the same before-the-fieldDef-lookup precedence; `session-detail`'s `userId` field now declares it (matching `sessions-list`) and its read-only display (`ReadOnlyReferenceValue`) also consults `SYSTEM_REFERENCE_LABELS`.

### Patch Changes

- Updated dependencies [8206493]
  - @cosmicdrift/kumiko-framework@0.238.0

## 0.237.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.237.2

## 0.237.1

### Patch Changes

- Updated dependencies [da3aed4]
  - @cosmicdrift/kumiko-framework@0.237.1

## 0.237.0

### Patch Changes

- Updated dependencies [0f399c2]
- Updated dependencies [1dca3bc]
- Updated dependencies [9b2eae0]
  - @cosmicdrift/kumiko-framework@0.237.0

## 0.236.1

### Patch Changes

- Updated dependencies [825acb8]
  - @cosmicdrift/kumiko-framework@0.236.1

## 0.236.0

### Patch Changes

- Updated dependencies [ccad32d]
- Updated dependencies [69529cd]
- Updated dependencies [e668a62]
  - @cosmicdrift/kumiko-framework@0.236.0

## 0.235.4

### Patch Changes

- Updated dependencies [c5a5dd4]
- Updated dependencies [41ef079]
  - @cosmicdrift/kumiko-framework@0.235.4

## 0.235.3

### Patch Changes

- Updated dependencies [fa9a541]
  - @cosmicdrift/kumiko-framework@0.235.3

## 0.235.2

### Patch Changes

- Updated dependencies [1ce74b3]
  - @cosmicdrift/kumiko-framework@0.235.2

## 0.235.1

### Patch Changes

- Updated dependencies [4c83a80]
  - @cosmicdrift/kumiko-framework@0.235.1

## 0.235.0

### Minor Changes

- 38d7ffc: The self-populating settings hub now also derives a screen from `r.secret(...)` declarations, alongside masked config keys.

  - New `secretsEdit` screen, grouped by declaring feature, shown under the tenant-audience nav with label/hint taken from the declaration.
  - The screen only appears when the `secrets` feature is mounted, and mirrors the access rule of `secrets:write:set`.
  - Inputs always start empty — the redacted preview is shown next to the field but never loaded into it; deleting a secret goes through `secrets:write:delete`.

  Consumer note: new screen type `SecretsEditScreenDefinition` added to the `ScreenDefinition` union — consumers that switch exhaustively on `screen.type` need to handle it.

### Patch Changes

- Updated dependencies [9dc8d1c]
- Updated dependencies [38d7ffc]
- Updated dependencies [5882fb3]
  - @cosmicdrift/kumiko-framework@0.235.0

## 0.234.0

### Patch Changes

- Updated dependencies [40a8143]
  - @cosmicdrift/kumiko-framework@0.234.0

## 0.233.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.233.0

## 0.232.0

### Patch Changes

- Updated dependencies [aeac06f]
- Updated dependencies [05bdf93]
- Updated dependencies [03a8df0]
  - @cosmicdrift/kumiko-framework@0.232.0

## 0.231.0

### Patch Changes

- Updated dependencies [404d143]
- Updated dependencies [5d4c21e]
- Updated dependencies [4f4bc49]
  - @cosmicdrift/kumiko-framework@0.231.0

## 0.230.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.230.0

## 0.229.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.229.1

## 0.229.0

### Patch Changes

- Updated dependencies [ebadd51]
  - @cosmicdrift/kumiko-framework@0.229.0

## 0.228.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.228.0

## 0.227.0

### Patch Changes

- Updated dependencies [5f157b6]
  - @cosmicdrift/kumiko-framework@0.227.0

## 0.226.0

### Patch Changes

- Updated dependencies [211ff70]
- Updated dependencies [db616cb]
- Updated dependencies [bcac6f3]
- Updated dependencies [c4ed490]
  - @cosmicdrift/kumiko-framework@0.226.0

## 0.225.0

### Patch Changes

- aa1a1a7: German/Spanish translations for the new `cap-overview` feature's strings, and the regenerated feature manifest (`create-kumiko-app`) that lists it as an available choice.
- Updated dependencies [aa1a1a7]
- Updated dependencies [d63b2e8]
  - @cosmicdrift/kumiko-framework@0.225.0

## 0.224.2

### Patch Changes

- Updated dependencies [415ff22]
  - @cosmicdrift/kumiko-framework@0.224.2

## 0.224.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.224.1

## 0.224.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.224.0

## 0.223.0

### Minor Changes

- c4d07f5: `createMultiSelectField` can now render as a checkbox grid instead of the combobox dropdown. Set `display: "checkboxes"` on the field to get one checkbox per option plus a select-all/deselect-all toggle; omitting `display` keeps the existing combobox behavior unchanged.

  Two more options come on top, both only meaningful with `display: "checkboxes"`:

  - `columns` (1–4) sets the grid's column count at the widest breakpoint; narrow viewports always collapse to a single column.
  - `maxRows` caps how many grid rows stay visible before the grid becomes vertically scrollable; omitted, the grid grows with its content.

  Setting `columns` or `maxRows` without `display: "checkboxes"`, or an invalid `maxRows` (not a positive integer), fails at boot.

### Patch Changes

- Updated dependencies [c4d07f5]
  - @cosmicdrift/kumiko-framework@0.223.0

## 0.222.0

### Patch Changes

- Updated dependencies [6a13c64]
- Updated dependencies [8edfaa0]
- Updated dependencies [b00604c]
- Updated dependencies [d3ec5e0]
- Updated dependencies [afceecd]
  - @cosmicdrift/kumiko-framework@0.222.0

## 0.221.0

### Patch Changes

- Updated dependencies [1656ff9]
- Updated dependencies [fab31bf]
  - @cosmicdrift/kumiko-framework@0.221.0

## 0.220.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.220.1

## 0.220.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.220.0

## 0.219.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.219.0

## 0.218.0

### Patch Changes

- Updated dependencies [bfae2fb]
  - @cosmicdrift/kumiko-framework@0.218.0

## 0.217.0

### Patch Changes

- Updated dependencies [02aadf9]
  - @cosmicdrift/kumiko-framework@0.217.0

## 0.216.0

### Patch Changes

- Updated dependencies [89654bc]
  - @cosmicdrift/kumiko-framework@0.216.0

## 0.215.7

### Patch Changes

- 93220e2: Panel-ready for offlot: translate projectionList facets, Members status-filter es/de, cap-list gauge icon, SystemAdmin cross-tenant delivery log (incl. SYSTEM_TENANT_ID).
  - @cosmicdrift/kumiko-framework@0.215.7

## 0.215.6

### Patch Changes

- @cosmicdrift/kumiko-framework@0.215.6

## 0.215.5

### Patch Changes

- Updated dependencies [16454c2]
  - @cosmicdrift/kumiko-framework@0.215.5

## 0.215.4

### Patch Changes

- Updated dependencies [e2a55b2]
  - @cosmicdrift/kumiko-framework@0.215.4

## 0.215.3

### Patch Changes

- be16c6b: Normalize the tenant-concept terminology: German UI copy now consistently says "Mandant" (was a mix of "Mandant"/"Tenant"/"Organisation" across bundles), Spanish consistently says "Organización" (was a mix of "Organización"/loanword "tenant"). English source copy for `config.settings.tenant` reverted to "Tenant" to match the chosen term.
- Updated dependencies [469ec58]
  - @cosmicdrift/kumiko-framework@0.215.3

## 0.215.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.215.2

## 0.215.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.215.1

## 0.215.0

### Patch Changes

- Updated dependencies [5cf7f9d]
- Updated dependencies [2bcf3c9]
  - @cosmicdrift/kumiko-framework@0.215.0

## 0.214.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.214.0

## 0.213.0

### Patch Changes

- fd90843: SignupCompleteScreen now shows a confirmation with a continue button after successful account activation, instead of silently redirecting.
- Updated dependencies [7ffd0f6]
- Updated dependencies [774ca7d]
  - @cosmicdrift/kumiko-framework@0.213.0

## 0.212.0

### Patch Changes

- 120e585: Audit log actor column and detail view now show a translated "System" label when an event's `createdBy` is the literal `"system"` string written by system-authored events (e.g. delivery attempts), instead of rendering an empty cell.
- Updated dependencies [35b0005]
- Updated dependencies [d006e42]
- Updated dependencies [28fc80a]
  - @cosmicdrift/kumiko-framework@0.212.0

## 0.211.0

### Patch Changes

- Updated dependencies [f38784b]
  - @cosmicdrift/kumiko-framework@0.211.0

## 0.210.0

### Patch Changes

- Updated dependencies [f2e6862]
- Updated dependencies [8b4467d]
- Updated dependencies [1ba89fb]
- Updated dependencies [d85987c]
- Updated dependencies [db14e69]
  - @cosmicdrift/kumiko-framework@0.210.0

## 0.209.1

### Patch Changes

- Updated dependencies [f387a20]
- Updated dependencies [2c05054]
  - @cosmicdrift/kumiko-framework@0.209.1

## 0.209.0

### Patch Changes

- Updated dependencies [f707d1b]
- Updated dependencies [49662ef]
- Updated dependencies [12df48b]
- Updated dependencies [f86cf43]
- Updated dependencies [b9fdc41]
- Updated dependencies [92a5361]
  - @cosmicdrift/kumiko-framework@0.209.0

## 0.208.3

### Patch Changes

- Updated dependencies [e595330]
- Updated dependencies [8087d17]
  - @cosmicdrift/kumiko-framework@0.208.3

## 0.208.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.208.2

## 0.208.1

### Patch Changes

- Updated dependencies [f538bc0]
  - @cosmicdrift/kumiko-framework@0.208.1

## 0.208.0

### Minor Changes

- 025c5b9: Framework UI copy is English-only. German and Spanish live in `@cosmicdrift/kumiko-locale-de` / `-es`. Apps that want those languages mount `localeDe()` + `localeDeClient()` (or the es equivalents). Without a locale package, framework screens and auth/GDPR mails render in English.

### Patch Changes

- Updated dependencies [025c5b9]
  - @cosmicdrift/kumiko-framework@0.208.0
