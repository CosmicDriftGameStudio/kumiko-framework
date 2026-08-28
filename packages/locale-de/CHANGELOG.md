# @cosmicdrift/kumiko-locale-de

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
- 2a74871: Fix `<NotesSection>` (notes-history bundle) rendering each entry as one unbroken line with the raw author id and raw ISO timestamp glued to the note text. Body and meta now render as two visually separated lines and the timestamp uses the shared `formatWhen` formatter.

  `note-entry` also gains an `authorName` field (`personal: { of: "authorId" }`, same crypto-shredding subject as `body`), stamped once at `add-note` write time — a self-lookup of the writer's own `read_users` row via `ctx.db.raw` (tenant-agnostic, same pattern as `user-data-rights/handlers/cancel-deletion.write.ts`), decrypting `displayName` with `decryptStoredPii`. Append-only history keeps the name as it was when the note was written, never re-resolved later against a mutable roster. A client-supplied `authorName` in the payload is ignored, same guard as `authorId`. If the self-lookup or decrypt fails, or the user has no `displayName`, `authorName` stays `null` and the write still succeeds — the note text is the point, the name is best-effort. The display already prefers `authorName` and falls back to a translated placeholder for `null` (pre-field history, shredded authors, and any lookup failure).

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
