# @cosmicdrift/kumiko-samples

## 0.411.0

### Patch Changes

- 7985ab1: StepList gets selection with prerequisites, Banner a compact one-line form with icon and an ok variant, FloatingPanel a fixed placement, and the new bundled feature presence shows who else is on a record.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: StepList selection with prerequisites, compact Banner, fixed FloatingPanel
  detail: `StepList` takes an optional `selection` (`selectedIds`, `onSelectionChange`, `actions`). It adds a checkbox per step, a "Select all" row with a count ("2 selected, 1 waiting for input") and, while something is selected, footer actions labelled with the count whose `onClick` receives the effective selection in list order. A step's `dependsOn` lists prerequisites: selecting the step selects them too (marked "Also selected: needed for …"), and unselecting a prerequisite drops the steps that need it. `selectable` per step is `{ kind: "selectable" }`, `{ kind: "missing-input", reason }` (checkbox disabled, "Input missing" tag) or `{ kind: "none" }` (no checkbox), so an app can keep risky steps out of bulk actions. A step whose open prerequisite cannot be selected is disabled with "Review “…” on its own first". Without `selection` the list renders as before. `Banner` takes `density: "compact"` (one line, title inline), `icon` (a nav icon key) and the variant `"ok"` for a finished state. `FloatingPanel` takes `placement: { mode: "fixed", rightPx, bottomPx, widthPx, heightPx }` (anchored, no drag, no resize, nothing persisted), `bodyLayout: "fill"` (children pad and scroll themselves) and `surface: "ai"`. New exports: `StepSelectability`, `StepSelectionAction`, `StepListSelection`, `FloatingPanelPlacement`, plus `usePresence`, `usePresenceList`, `PresenceNotice`, `PresenceAvatars`; `Avatar` takes `size: "xs"` and `shape: "round"`.
  -->
  
  <!-- kumiko-changes
  feature: presence
  type: improvement
  title: New bundled feature presence: who else is on this record right now
  detail: `createPresenceFeature({ entities, roles?, ttlSeconds? })` lets a browser announce that the user is viewing or editing one row of an allow-listed entity (`presence:write:heartbeat` every 15 seconds, `presence:write:leave` on close) and answers with the other people on it; `presence:query:list` returns them for up to 100 rows of a list. It only informs and never locks. State is ephemeral in a Redis hash per session tenant, entity and row (in memory without Redis), holds user ids only and expires after `ttlSeconds` (default 45) without a heartbeat; display names are resolved per response. A caller sees presence only for rows they can read; other rows answer 404. Defaults to TenantAdmin and TenantMember, entities default to none, the handlers are hidden from the AI agent. A Redis or SSE outage logs a warning and answers with an empty room. On a change the other people on the row get an addressed live signal through the new handler service `ctx.services.userLiveSignals`, which pushes SSE frames to named users of the caller's own tenant. The renderer hooks `usePresence` and `usePresenceList` and the widgets `PresenceNotice` and `PresenceAvatars` stay silent when the feature is not mounted.
  -->

## 0.410.0

### Patch Changes

- f51a369: Public handlers admit signed-in visitors whatever their roles (`anySignedIn`), the contact website client types ship under `contact/client`, the report form names the app and Telegram is documented as optional.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: anySignedIn: public handlers admit every signed-in caller
  detail: A role rule that includes `anonymous` may add `anySignedIn: true` (`{ roles: ["anonymous"], anySignedIn: true }`). A signed-in caller then passes whatever roles the session carries, because the browser sends the session cookie to a public endpoint and an app-specific role (for example "Hausmeister") used to turn away a visitor who is welcome anonymously. `hasAccess` and `isUiAccessGranted` honour the flag, nav entries with such a rule stay visible to every viewer, and feature-ast reads and writes it. The boot validator rejects `anySignedIn` on a rule without `anonymous` (use `openToAll` for "every signed-in user") and any value other than `true` (rule `handler/any-signed-in-invalid`). The public handlers of bundled features now set it: waitlist submit, contact challenge and submit, user-data-rights deletion by email and token and download by token, managed-pages published pages and branding, file-derivatives public variants, compliance-profiles sub-processors, tenant-inactivity keep-account, auth-email-password login options and self-registration status, template-resolver by tenant and slug, seo config and subscription-paddle checkout config. Anonymous-only auth flows (signup, reset password, verify email, invite info, account unlock, MFA preauth) are unchanged.
  -->
  
  <!-- kumiko-changes
  feature: contact
  type: improvement
  title: contact/client subpath, app name in the report hint, Telegram documented as optional
  detail: `@cosmicdrift/kumiko-bundled-features/contact/client` exports `CONTACT_CLIENT_SOURCE` and the website client types `ContactWebsiteClient`, `ContactWebsiteWindow`, `ContactWebsiteSubmitFields`, `ContactWebsiteSubmitResult`, `ContactWebsiteFormOptions` and `ContactWebsiteKind`. The report form hint reads "Goes straight to the {appName} team" with the `appName` option (de, en, es, fr, it). With the default `telegram: false` the feature lists `channel-telegram` as an optional dependency only; the feature manifest, the recipe and the docs no longer show the Telegram config key or `contact:write:send-test` for that default. A signed-in visitor with any role can submit the website form and fetch the challenge.
  -->
  
  <!-- kumiko-changes
  feature: waitlist
  type: fix
  title: Signed-in visitors can join the waitlist whatever their roles
  detail: `waitlist:write:submit` used to answer 403 when the browser sent the session cookie of a user without one of the listed roles. It now admits every signed-in caller through `anySignedIn`.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: actionForm summary params
  detail: `summary.params` (`Record<string, string>`) of an actionForm screen interpolates fixed values, such as an app name a feature option sets, into the summary title and subtitle. They are merged with the formatted drawer prefill and win on a name clash.
  -->

## 0.409.0

No changes in this release.

## 0.408.0

No changes in this release.

## 0.407.0

No changes in this release.

## 0.406.0

No changes in this release.

## 0.405.0

No changes in this release.

## 0.404.1

No changes in this release.

## 0.404.0

No changes in this release.

## 0.403.0

No changes in this release.

## 0.402.0

No changes in this release.

## 0.401.0

No changes in this release.

## 0.400.0

No changes in this release.

## 0.399.0

No changes in this release.

## 0.398.0

No changes in this release.

## 0.397.0

No changes in this release.

## 0.396.0

No changes in this release.

## 0.395.0

No changes in this release.

## 0.394.0

No changes in this release.

## 0.393.0

No changes in this release.

## 0.392.2

No changes in this release.

## 0.392.1

No changes in this release.

## 0.392.0

No changes in this release.

## 0.391.1

No changes in this release.

## 0.391.0

No changes in this release.

## 0.390.1

No changes in this release.

## 0.390.0

### Patch Changes

- 54cda5b: Integration tests seed event-sourced rows through the event store and reset event-sourced tables together with the events table.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Tests seed and reset event-sourced tables through the event store
  detail: Seeds of user, membership, tenant and other entity rows use seedRowViaEventStore instead of seedRow, so their created events exist. Setup and teardown hooks in the integration tests clear event-sourced tables through resetTestTables instead of raw DELETE statements, and clear the events table in the same call, so a test no longer starts with events whose projection rows are gone. Nothing changes for apps; the packages are only republished.
  -->

## 0.389.0

No changes in this release.

## 0.388.0

No changes in this release.

## 0.387.0

No changes in this release.

## 0.386.0

No changes in this release.

## 0.385.0

No changes in this release.

## 0.384.0

No changes in this release.

## 0.383.1

No changes in this release.

## 0.383.0

No changes in this release.

## 0.382.0

No changes in this release.

## 0.381.0

No changes in this release.

## 0.380.0

No changes in this release.

## 0.379.0

### Patch Changes

- ece210b: Samples pass the registry to createTemplateResolverApi.
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Samples follow the createTemplateResolverApi(db, registry) signature
  detail: Recipes and sample apps build the template resolver API with the registry as second argument.
  -->

## 0.378.0

No changes in this release.

## 0.377.0

No changes in this release.

## 0.376.0

No changes in this release.

## 0.375.0

No changes in this release.

## 0.374.0

No changes in this release.

## 0.373.0

No changes in this release.

## 0.372.0

No changes in this release.

## 0.371.1

No changes in this release.

## 0.371.0

No changes in this release.

## 0.370.0

No changes in this release.

## 0.369.0

No changes in this release.

## 0.368.0

No changes in this release.

## 0.367.0

No changes in this release.

## 0.366.0

No changes in this release.

## 0.365.1

No changes in this release.

## 0.365.0

### Patch Changes

- b6b75fa: pdf-audit-export rejects oversized periods; sample docs and licence fixes
  
  <!-- kumiko-changes
  feature: samples
  type: fix
  title: pdf-audit-export rejects oversized periods; sample docs and licence fixes
  detail: The audit export fails with 422 audit_period_too_large above 100 rows instead of silently truncating. The samples LICENSE names the right Licensed Work.
  -->

## 0.364.0

No changes in this release.

## 0.363.0

## 0.362.0

## 0.361.0

## 0.360.0

## 0.359.0

## 0.358.0

## 0.357.0

## 0.356.0

## 0.355.0

## 0.354.1

## 0.354.0

## 0.353.0

## 0.352.0

## 0.351.0

## 0.350.0

## 0.349.0

## 0.348.1

## 0.348.0

## 0.347.0

## 0.346.0

## 0.345.0

## 0.344.0

## 0.343.0

## 0.342.0

## 0.341.0

## 0.340.0

## 0.339.0

### Patch Changes

- 2ae49bc: The workspace link of `@cosmicdrift/kumiko-samples` now shows the published layout. `packages/samples/{samples,packages}` hold checked-in relative symlinks to the repo sources, so a consumer that resolves `@cosmicdrift/kumiko-samples/package.json` in a workspace finds `samples/recipes`, `samples/apps` and `packages/bundled-features` next to it. `prepack` swaps the symlinks for the filtered real copies and `postpack` restores them. The published tarball is unchanged.

  <!-- kumiko-changes
  feature: samples
  type: improvement
  title: Workspace link of kumiko-samples shows the published layout through checked-in symlinks
  detail: |
    `scripts/stage-samples-package.ts` declares the shipped layout once. `stage` replaces the symlinks with filtered copies for packing, `clean` removes the copies and restores the symlinks. `verify-samples-package.sh` now expects the symlinks, not an empty folder, after packing.
  -->

## 0.338.0

### Minor Changes

- b036209: New package with the sample recipes, sample apps and bundled-features sources

  `@cosmicdrift/kumiko-samples` ships the sample recipes, sample apps and bundled-features sources in the repository layout. Tools such as the few-shot corpus build can run against a pinned version of it and get the same entry ids and source paths as in the monorepo.

  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: New package @cosmicdrift/kumiko-samples with the corpus sources
  -->
