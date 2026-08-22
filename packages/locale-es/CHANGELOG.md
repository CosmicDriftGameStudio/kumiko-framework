# @cosmicdrift/kumiko-locale-es

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
