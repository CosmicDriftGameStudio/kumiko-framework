# @cosmicdrift/kumiko-document-designer

## 0.395.0

### Patch Changes

- Updated dependencies [6599341]
- Updated dependencies [22ded17]
- Updated dependencies [092c5d7]
- Updated dependencies [6599341]
- Updated dependencies [9bce295]
- Updated dependencies [373a722]
  - @cosmicdrift/kumiko-bundled-features@0.395.0
  - @cosmicdrift/kumiko-renderer@0.395.0
  - @cosmicdrift/kumiko-types@0.395.0
  - @cosmicdrift/kumiko-framework@0.395.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.395.0

## 0.394.0

### Patch Changes

- Updated dependencies [a91f814]
- Updated dependencies [6effc06]
- Updated dependencies [5760047]
- Updated dependencies [5760047]
- Updated dependencies [5760047]
- Updated dependencies [5760047]
- Updated dependencies [0a3288c]
- Updated dependencies [b638ec7]
- Updated dependencies [307f9cb]
- Updated dependencies [6831978]
- Updated dependencies [a91f814]
- Updated dependencies [9638cd4]
- Updated dependencies [9c4e277]
- Updated dependencies [9638cd4]
- Updated dependencies [9638cd4]
- Updated dependencies [9638cd4]
- Updated dependencies [d24b405]
- Updated dependencies [eecf6fa]
- Updated dependencies [9638cd4]
- Updated dependencies [d40dded]
- Updated dependencies [9c4e277]
- Updated dependencies [9c4e277]
- Updated dependencies [a91f814]
- Updated dependencies [a91f814]
- Updated dependencies [b638ec7]
- Updated dependencies [b638ec7]
- Updated dependencies [307f9cb]
  - @cosmicdrift/kumiko-bundled-features@0.394.0
  - @cosmicdrift/kumiko-framework@0.394.0
  - @cosmicdrift/kumiko-renderer@0.394.0
  - @cosmicdrift/kumiko-types@0.394.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.394.0

## 0.393.0

### Patch Changes

- Updated dependencies [c01eb22]
  - @cosmicdrift/kumiko-bundled-features@0.393.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.393.0
  - @cosmicdrift/kumiko-renderer@0.393.0
  - @cosmicdrift/kumiko-framework@0.393.0
  - @cosmicdrift/kumiko-types@0.393.0

## 0.392.2

### Patch Changes

- Updated dependencies [9bd6b78]
- Updated dependencies [970a751]
  - @cosmicdrift/kumiko-bundled-features@0.392.2
  - @cosmicdrift/kumiko-framework@0.392.2
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.392.2
  - @cosmicdrift/kumiko-renderer@0.392.2
  - @cosmicdrift/kumiko-types@0.392.2

## 0.392.1

### Patch Changes

- Updated dependencies [51fc72c]
- Updated dependencies [1ded969]
  - @cosmicdrift/kumiko-bundled-features@0.392.1
  - @cosmicdrift/kumiko-renderer@0.392.1
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.392.1
  - @cosmicdrift/kumiko-framework@0.392.1
  - @cosmicdrift/kumiko-types@0.392.1

## 0.392.0

### Patch Changes

- Updated dependencies [383b6a8]
- Updated dependencies [99eea8a]
- Updated dependencies [4810041]
- Updated dependencies [3cfb343]
- Updated dependencies [3d7f455]
- Updated dependencies [c22ca75]
- Updated dependencies [e92277d]
- Updated dependencies [05c9bef]
- Updated dependencies [c639de3]
- Updated dependencies [95227c3]
  - @cosmicdrift/kumiko-framework@0.392.0
  - @cosmicdrift/kumiko-bundled-features@0.392.0
  - @cosmicdrift/kumiko-types@0.392.0
  - @cosmicdrift/kumiko-renderer@0.392.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.392.0

## 0.391.1

### Patch Changes

- Updated dependencies [70ceb25]
- Updated dependencies [20b9632]
  - @cosmicdrift/kumiko-framework@0.391.1
  - @cosmicdrift/kumiko-bundled-features@0.391.1
  - @cosmicdrift/kumiko-renderer@0.391.1
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.391.1
  - @cosmicdrift/kumiko-types@0.391.1

## 0.391.0

### Patch Changes

- Updated dependencies [8e6d41e]
- Updated dependencies [c823c6f]
- Updated dependencies [6629d51]
- Updated dependencies [ffe0424]
  - @cosmicdrift/kumiko-framework@0.391.0
  - @cosmicdrift/kumiko-bundled-features@0.391.0
  - @cosmicdrift/kumiko-types@0.391.0
  - @cosmicdrift/kumiko-renderer@0.391.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.391.0

## 0.390.1

### Patch Changes

- Updated dependencies [8297c01]
  - @cosmicdrift/kumiko-framework@0.390.1
  - @cosmicdrift/kumiko-bundled-features@0.390.1
  - @cosmicdrift/kumiko-renderer@0.390.1
  - @cosmicdrift/kumiko-types@0.390.1
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.390.1

## 0.390.0

### Patch Changes

- 4b36bd9: The complexity guard now scans .tsx files with the same hard cap of 40 as .ts.
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Complexity guard covers .tsx with the hard cap of 40
  detail: The Complexity Check scans .tsx files next to .ts (.test.tsx stays excluded), and conditional JSX counts as a branch. A .tsx function above complexity 40 fails in the repo's own files, regardless of baseline or complexity-budget tag.
  migration: Run `kumiko-guards guards --write-baseline --guard="Complexity Check"` once on the bump to freeze the .tsx hotspots between 15 and 40, and split every .tsx function above 40 before the bump; the complexity-budget tag and the baseline do not cover it. Measured on 2026-10-23 (function, complexity / lines): offlot-app ComposerWorkspace 129/597 (campaign-composer-screen.tsx) and ComposerPostText 47/289 (composer-post-drawer.tsx); kumiko-enterprise AgentPanelBody 74/634 (agent-panel-body.tsx); phronexsis WorkbenchDashboardScreen 64/653 (workbench-dashboard-screen.tsx); money-horse CreditCalculatorScreen 60/468 (credit-calculator-screen.tsx); solon CockpitDetail 58/462 (inbox-cockpit-screen.tsx). publicstatus, show-pony, kumiko-studio and kumiko-platform have no .tsx function above 40.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: PDF editor actions drop unreachable null checks
  detail: generatePdf, printOnce and the save path of the PDF template editor no longer check for a missing editor state; the editor only builds its actions once the state is loaded, and the type already excludes null. A new test pins the publishSystem path for a SystemAdmin who holds a clean tenant template.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: One tiptap range across the framework packages
  detail: bundled-features pinned @tiptap/* exactly to 3.31.3 while the renderer asked for ^3.30.5. Apps resolved the renderer's range to a newer patch and kept the exact pin next to it, so their lockfiles held two @tiptap/core and @tiptap/react instances (core 3.31.3 and 3.31.4 in offlot-app, money-horse, publicstatus, phronexsis, show-pony and kumiko-enterprise). Both packages now declare ^3.31.3 for every @tiptap/* dependency, so one resolved version satisfies both; the framework lockfile still resolves 3.31.3.
  -->
- 87271b5: The PDF template editor only uses a template detail whose id matches the row picked for the current scope and locale.
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: The PDF editor no longer saves or publishes the previous row after a scope switch
  detail: When the host scope changed while the editor was open, for example once the SystemAdmin role loaded, the editor kept showing the tenant copy until the system row arrived. Save then wrote the tenant content as the system template, and publish sent the tenant row to publishSystem. The editor now shows the loading state until the detail of the newly picked row has loaded.
  -->
- 839325f: Split the PDF, layout and mail editors into state hooks, logic modules and render functions.
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Split PDF, layout and mail editors into hooks and render functions
  detail: PdfTemplateEditor, LayoutEditorBody and MailEditorBody compose focused state hooks, pure logic modules and render functions for chrome, panes and previews. Rendered markup and behavior are unchanged.
  -->
- Updated dependencies [38e816b]
- Updated dependencies [2376b07]
- Updated dependencies [1a7eebe]
- Updated dependencies [5d7dfe1]
- Updated dependencies [a01d30a]
- Updated dependencies [c2fd4b3]
- Updated dependencies [4f4ec30]
- Updated dependencies [86af2d0]
- Updated dependencies [22f792d]
- Updated dependencies [84e9d9c]
- Updated dependencies [c2fd4b3]
- Updated dependencies [454b49d]
- Updated dependencies [4b36bd9]
- Updated dependencies [21b70ba]
- Updated dependencies [be576a7]
- Updated dependencies [5ee91c6]
- Updated dependencies [febcd93]
- Updated dependencies [c2fd4b3]
- Updated dependencies [febcd93]
- Updated dependencies [abef0e6]
- Updated dependencies [01a611f]
- Updated dependencies [c2fd4b3]
- Updated dependencies [3131c5c]
- Updated dependencies [8d06990]
- Updated dependencies [c2fd4b3]
- Updated dependencies [6d20414]
- Updated dependencies [f6d230f]
- Updated dependencies [e0e2dfe]
- Updated dependencies [8c25e2f]
- Updated dependencies [d6c1dec]
- Updated dependencies [22f9f23]
- Updated dependencies [9cf6cc6]
- Updated dependencies [6c1151a]
- Updated dependencies [54cda5b]
- Updated dependencies [9e6de88]
- Updated dependencies [a08fc93]
- Updated dependencies [78654fd]
- Updated dependencies [c64181f]
- Updated dependencies [1d392a4]
- Updated dependencies [276216d]
- Updated dependencies [5d38d3c]
- Updated dependencies [dd62f90]
- Updated dependencies [f5f2fe9]
- Updated dependencies [a01d30a]
  - @cosmicdrift/kumiko-bundled-features@0.390.0
  - @cosmicdrift/kumiko-framework@0.390.0
  - @cosmicdrift/kumiko-renderer@0.390.0
  - @cosmicdrift/kumiko-types@0.390.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.390.0

## 0.389.0

### Patch Changes

- 8a6508a: The layout editor edits the scope of the screen it was opened from. Before, a SystemAdmin who clicked Edit on a system-origin layout row on the tenant screen silently edited and published the system layout for all tenants. The tenant overview now always opens the tenant editor, the platform overview opens the new `platform-layout-editor` screen (SystemAdmin only) for the system layout, the editor asks `layout-source` for `scope` tenant or system, and `layout-source` refuses `scope: "system"` for anyone but a SystemAdmin.
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: layout editor scope follows the entry screen
  detail: The tenant overview opens layout rows in the tenant editor even for a SystemAdmin, so a system-origin row there loads and saves the tenant layout through layout-source with scope tenant and upsert-tenant. The platform overview opens the new platform-layout-editor screen (PLATFORM_LAYOUT_EDITOR_SCREEN_ID) for the system layout. layout-source takes an optional scope and answers 403 to scope system for non-SystemAdmins. templateRowActions now takes { platform }.
  -->
- fe7a9b3: The mail editor drops a record pick when the declared variables of the template change. Before, a pick kept travelling with preview and test mail and, once a variable was removed and added again, brought its old value back. A pick for a variable that is not declared is still filtered out of the request.
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: mail editor resets the record pick when variables change
  detail: The picked record values are cleared as soon as the set of declared variables changes, so a removed or renamed variable no longer leaves a stale pick behind and a re-added variable does not revive an old value.
  -->
- Updated dependencies [47ba075]
- Updated dependencies [1b3a297]
- Updated dependencies [ed98312]
- Updated dependencies [c16fa0c]
- Updated dependencies [ac00e8a]
- Updated dependencies [7ca1a98]
- Updated dependencies [95b16ff]
- Updated dependencies [1b8c7ba]
- Updated dependencies [7b3c3c0]
- Updated dependencies [77a25ac]
- Updated dependencies [e2211ac]
- Updated dependencies [641f268]
- Updated dependencies [ffbb25e]
- Updated dependencies [641f268]
- Updated dependencies [ffbb25e]
- Updated dependencies [ad0c891]
- Updated dependencies [947470b]
- Updated dependencies [1dc3182]
- Updated dependencies [dd5fd28]
- Updated dependencies [a50674e]
- Updated dependencies [8a6508a]
- Updated dependencies [53e2a0e]
- Updated dependencies [9253635]
- Updated dependencies [ab1ca17]
- Updated dependencies [f75a6dd]
- Updated dependencies [5b72552]
- Updated dependencies [bd1b61a]
- Updated dependencies [5947ab0]
- Updated dependencies [7d5f95c]
- Updated dependencies [2dd1de3]
- Updated dependencies [7336a78]
- Updated dependencies [768a67e]
- Updated dependencies [f0c2983]
- Updated dependencies [c14ccd3]
- Updated dependencies [ae805dd]
- Updated dependencies [203085b]
- Updated dependencies [6eb3960]
- Updated dependencies [6bb9d66]
- Updated dependencies [a407a3c]
- Updated dependencies [9a72476]
- Updated dependencies [d8f9c73]
- Updated dependencies [91fb415]
- Updated dependencies [9253635]
- Updated dependencies [e5fe5f2]
- Updated dependencies [8628ea3]
- Updated dependencies [bec6021]
- Updated dependencies [ae66401]
- Updated dependencies [bec6021]
- Updated dependencies [9253635]
- Updated dependencies [a50674e]
- Updated dependencies [59028a5]
- Updated dependencies [5b707a6]
- Updated dependencies [cee9e32]
- Updated dependencies [aa83c70]
- Updated dependencies [bec6021]
- Updated dependencies [a50674e]
- Updated dependencies [80399a2]
- Updated dependencies [59028a5]
- Updated dependencies [a50674e]
- Updated dependencies [c37831d]
- Updated dependencies [d6940f1]
- Updated dependencies [ff84ee4]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [8449190]
- Updated dependencies [080c5e7]
- Updated dependencies [76c95ae]
  - @cosmicdrift/kumiko-bundled-features@0.389.0
  - @cosmicdrift/kumiko-framework@0.389.0
  - @cosmicdrift/kumiko-types@0.389.0
  - @cosmicdrift/kumiko-renderer@0.389.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.389.0

## 0.388.0

### Patch Changes

- ff553d1: Row actions stay on one line, edit forms keep declared columns and select width, and a system-scope configEdit reads the system level.
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Single-line row actions, stable form columns and select width, system-scope configEdit
  detail: Row actions never wrap onto a second line; the template overview lets long titles break and cuts the slug earlier so the table keeps room at 1280 px. In screen forms a section with explicitly declared columns (two or more) lays out as that many columns, and a select cell is as wide as a text cell instead of growing with its help text. A configEdit screen with scope system now reads the system level, so a SystemAdmin no longer sees the value of their own tenant row.
  -->
- 2fb7e2b: Review fixes: the waitlist legacy migration dry run reports the streams it would archive, the document designer shares its mail layout constants and tenant currency lookup with the server and renderer, drops stale picked preview values, and reads singular tenant counts correctly.
  
  <!-- kumiko-changes
  feature: waitlist
  type: fix
  title: Legacy migration dry run counts the streams it would archive
  detail: The dry run now runs the read-only archive checks and reports archivedStreams without writing; the CLI prints "would archive" for it.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Picked preview values are filtered to declared variables
  detail: A picked record value for a variable the template does not declare no longer travels into the preview or test mail, which the server rejected as an unknown variable.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Singular tenant counts in the override texts
  detail: The override summary and the system origin bar use plural forms, so one customising tenant reads "1 tenant has its own version" in en, de and es.
  -->
  
  <!-- kumiko-changes
  feature: template-resolver
  type: fix
  title: Mail layout enums and hex color pattern are exported client-side
  detail: The layout editor imports the width, font, accent line and button style lists plus the hex pattern from the template-resolver web barrel instead of keeping copies, so editor and server validation cannot drift.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: useTenantCurrency hook
  detail: The tenant currency resolution of the entity edit prefill is exported as a hook with an explicit fallback for errors and missing values and no query when no currency is needed; the mail preview uses it only for templates with a money variable.
  -->
- 22bc0a7: Review fixes: seeded layout titles resolve in the PDF editor and mail rail, the client-error rate limiter evicts the least recently seen IPs instead of resetting every window, the SSE heartbeat ping counts towards stalled-client detection, and the `__Host-` session cookies are expired even with `secureCookies:false`. The exported `runAsDirectCallEntry` is now `runAsAgentToolCallEntry`.
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Seeded layout titles show translated in the PDF editor and mail rail
  detail: A layout seeded with a title i18n key now shows its translated name in the PDF editor header and the mail editor properties rail instead of the raw key.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Client-error rate limit survives address rotation
  detail: Without Redis, the per-process limiter now drops the least recently seen IPs when more than 10000 are tracked, so a flood of fresh addresses no longer resets the window of every other IP.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Stalled SSE clients are dropped without further broadcasts
  detail: The heartbeat ping is written and tracked like entity frames instead of awaited, so a client that stopped reading is aborted at the next heartbeat after the stall timeout and releases its broker slot.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Leftover __Host- cookies are expired with secureCookies:false too
  detail: Clearing the session cookies now always sends the Secure delete for the __Host- auth and csrf variants when the configured names are unprefixed, so an app switched to secureCookies:false behind a TLS proxy no longer keeps a stale __Host- csrf cookie.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: runAsDirectCallEntry renamed to runAsAgentToolCallEntry
  detail: The internal request-context helper also marks its scope as an agent tool call, so the name now says so; it stays reserved for dispatchToolCall.
  migration: replace imports of runAsDirectCallEntry from @cosmicdrift/kumiko-framework/internal/request-context with runAsAgentToolCallEntry; the signature is unchanged
  -->
- Updated dependencies [7e54012]
- Updated dependencies [f81f639]
- Updated dependencies [bd38fdc]
- Updated dependencies [7447ac1]
- Updated dependencies [7e54012]
- Updated dependencies [b4be520]
- Updated dependencies [ff553d1]
- Updated dependencies [e1c01e4]
- Updated dependencies [2b49eb8]
- Updated dependencies [be79841]
- Updated dependencies [1adee91]
- Updated dependencies [9eec92b]
- Updated dependencies [044428c]
- Updated dependencies [9ba9cf4]
- Updated dependencies [7e54012]
- Updated dependencies [4e3bb2c]
- Updated dependencies [ff553d1]
- Updated dependencies [6262122]
- Updated dependencies [453b3f0]
- Updated dependencies [4ce85cd]
- Updated dependencies [ee0aaf9]
- Updated dependencies [ed4e21b]
- Updated dependencies [374a12b]
- Updated dependencies [cecdf71]
- Updated dependencies [014b9ab]
- Updated dependencies [37db191]
- Updated dependencies [b62c381]
- Updated dependencies [ab7c4ee]
- Updated dependencies [5520352]
- Updated dependencies [a0a8204]
- Updated dependencies [7ef7e6c]
- Updated dependencies [2924949]
- Updated dependencies [c52702e]
- Updated dependencies [b62e6cd]
- Updated dependencies [1e3e94d]
- Updated dependencies [084c9c0]
- Updated dependencies [c5b197e]
- Updated dependencies [c2a97fd]
- Updated dependencies [669cd2e]
- Updated dependencies [3c57f8f]
- Updated dependencies [2fb7e2b]
- Updated dependencies [22bc0a7]
- Updated dependencies [32cf2fe]
- Updated dependencies [5e03e77]
- Updated dependencies [52859ba]
- Updated dependencies [6884324]
- Updated dependencies [2638a4a]
- Updated dependencies [b137525]
- Updated dependencies [f507989]
- Updated dependencies [da784a9]
- Updated dependencies [ff5f68e]
- Updated dependencies [1425622]
  - @cosmicdrift/kumiko-framework@0.388.0
  - @cosmicdrift/kumiko-renderer@0.388.0
  - @cosmicdrift/kumiko-bundled-features@0.388.0
  - @cosmicdrift/kumiko-types@0.388.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.388.0

## 0.387.0

### Patch Changes

- Updated dependencies [10d7581]
- Updated dependencies [935306d]
- Updated dependencies [39afc25]
- Updated dependencies [e4ea6e1]
- Updated dependencies [5a25c89]
- Updated dependencies [2b4c84a]
- Updated dependencies [c25b54f]
- Updated dependencies [de7a63d]
  - @cosmicdrift/kumiko-framework@0.387.0
  - @cosmicdrift/kumiko-bundled-features@0.387.0
  - @cosmicdrift/kumiko-renderer@0.387.0
  - @cosmicdrift/kumiko-types@0.387.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.387.0

## 0.386.0

### Patch Changes

- Updated dependencies [f0a9e8f]
- Updated dependencies [5759e39]
  - @cosmicdrift/kumiko-framework@0.386.0
  - @cosmicdrift/kumiko-types@0.386.0
  - @cosmicdrift/kumiko-renderer@0.386.0
  - @cosmicdrift/kumiko-bundled-features@0.386.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.386.0

## 0.385.0

### Patch Changes

- Updated dependencies [3b011a8]
- Updated dependencies [9950dd0]
- Updated dependencies [e345be5]
  - @cosmicdrift/kumiko-framework@0.385.0
  - @cosmicdrift/kumiko-bundled-features@0.385.0
  - @cosmicdrift/kumiko-types@0.385.0
  - @cosmicdrift/kumiko-renderer@0.385.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.385.0

## 0.384.0

### Minor Changes

- 26cd745: Security, performance and auth defaults: CSP script hashes for hostDispatch pages, a batched file-meta route, lazy editors and pickers, a per-tenant override count in the template overview, and forgot-password and account-unlock wired by default.
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: hostDispatch pages get the build's CSP script hashes
  detail: The deps passed to hostDispatch now carry cspScriptHashes (the inline-script hashes from csp-hashes.json). Build the page CSP with buildDefaultCsp(deps.cspScriptHashes), now exported, so per-host pages keep script-src without unsafe-inline. runDevApp passes an empty list because dev serves no per-host CSP.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: GET /files/meta?ids= returns file metadata in one request
  detail: Up to 100 comma-separated file ids per call (more answers 400 too_many_ids). The same tenant and access checks as /files/:id/meta apply per id; unknown, foreign and invalid ids are left out of the answer. The renderer's file thumbnails and file names batch their lookups through it, so a list of N files no longer issues N meta requests.
  -->
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Template overview reports tenant overrides per template
  detail: template-resolver has a SystemAdmin query tenant-override-counts, and the overview rows for system templates carry overriddenBy { active, total } for SystemAdmins. The designer's overview reads it instead of issuing one tenant-overrides query per row. Reading it uses a declared unsafeRaw escape hatch because it counts across tenants.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: DayPicker and QR code load on demand
  detail: The calendar popover and the QR secret value import react-day-picker and qrcode lazily, so screens without a date input or an MFA setup no longer ship them. Date popovers render their grid one tick later; tests should use findBy queries.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Layout, mail and PDF template editors load lazily
  detail: The editors are split into their own chunks and show a loading state while they load. The PdfTemplateEditor export of the web barrel is unchanged.
  -->
  
  <!-- kumiko-changes
  feature: auth-email-password
  type: improvement
  title: Forgot-password and account-unlock work without app wiring
  detail: With auth.mail and SMTP configured, runProdApp and runDevApp now also wire the account-unlock flow (POST /api/auth/request-account-unlock and /api/auth/confirm-account-unlock, mail link to /unlock-account) because the login lockout is always on. emailPasswordClient serves ForgotPasswordScreen, ResetPasswordScreen (with token) and the unlock screens at /forgot-password, /reset-password and /unlock-account; gates registered earlier by the app win, and defaultAuthPages: false turns it off. LoginScreen reads the new anonymous login-options query and shows the forgot and unlock links when the flows exist; explicit forgotPasswordHref and unlockAccountHref still win and null hides a link. The query needs anonymousAccess on the app, otherwise no link appears.
  -->
  
  <!-- kumiko-changes
  feature: user-data-rights
  type: improvement
  title: Privacy center subtitle no longer mentions deletion when it is hidden
  detail: With privacyCenterShowDeletion false the screen description uses the new key userDataRights.privacyCenter.subtitleWithoutDeletion (English, German, French, Spanish and Italian provided) instead of the text that names Art. 17.
  -->

### Patch Changes

- Updated dependencies [c28119a]
- Updated dependencies [f516b5d]
- Updated dependencies [26cd745]
- Updated dependencies [26cd745]
- Updated dependencies [26cd745]
  - @cosmicdrift/kumiko-framework@0.384.0
  - @cosmicdrift/kumiko-bundled-features@0.384.0
  - @cosmicdrift/kumiko-types@0.384.0
  - @cosmicdrift/kumiko-renderer@0.384.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.384.0

## 0.383.1

### Patch Changes

- Updated dependencies [4ea38e1]
  - @cosmicdrift/kumiko-framework@0.383.1
  - @cosmicdrift/kumiko-bundled-features@0.383.1
  - @cosmicdrift/kumiko-renderer@0.383.1
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.383.1
  - @cosmicdrift/kumiko-types@0.383.1

## 0.383.0

### Minor Changes

- 9ef4b39: Support-friendly error UI, client error reporting, a wider leave guard and an IBAN text format: errors show a copyable reference, browser errors reach the server, global navigation asks before dropping unsaved input and `format: "iban"` validates IBANs.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Error reference with copy button in toasts, banners and fallbacks
  detail: A server error that carries a request id now shows "Error ID: <id>" with a copy button in toasts, action error banners, the write-form error section, query error banners and list empty states. The root and screen error fallbacks show a per-error id the same way; the root fallback is styled with inline styles so it stays readable without CSS. New exports ErrorReference, ErrorNotice and errorNoticeOf; New keys kumiko.error.reference, kumiko.error.copyReference and kumiko.error.referenceCopied in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: HeaderActionsBar onError receives an ErrorNotice instead of a string
  detail: The onError prop of HeaderActionsBar is now (notice: ErrorNotice | null) => void, where ErrorNotice is { message, requestId? }, so the error reference can be shown next to the message.
  migration: change the handler to read notice.message (and notice.requestId); a handler that stores the string only needs `notice?.message ?? null`
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: createKumikoApp reports browser errors to POST /api/client-errors
  detail: New option reportClientErrors (default true) sends error-boundary errors (kind render) and window error and unhandledrejection events (kind unhandled) to /api/client-errors with the same errorId the fallback shows, at most 5 reports per page load, identical messages once, path without query and hash, CSRF header when a token is present. A custom onError runs in addition and receives { errorId, screen? } as third argument. Set reportClientErrors: false to opt out.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Global navigation with search params asks before dropping unsaved input
  detail: navigateWithReturnTo, navigateToReturn, the metric tab navigation, closing the editor panel and the target resolver now go through the leave guard, and a requestLeave nested in a confirmed leave no longer asks twice. List filters and sorting stay unguarded because they do not unmount a form. The mail designer registers its draft as unsaved input, so link and browser navigation ask before discarding it.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Text field format "iban"
  detail: createTextField({ format: "iban" }) validates the value server-side (spaces ignored, case-insensitive, country and check digits shape plus mod-97) and reports invalid_format with format iban, which the form maps to errors.validation.invalid_format.iban (texts in en, de, es, fr, it). The value is stored as typed.
  -->

### Patch Changes

- Updated dependencies [72ac4b1]
- Updated dependencies [9ef4b39]
- Updated dependencies [9ef4b39]
- Updated dependencies [9ef4b39]
  - @cosmicdrift/kumiko-framework@0.383.0
  - @cosmicdrift/kumiko-types@0.383.0
  - @cosmicdrift/kumiko-renderer@0.383.0
  - @cosmicdrift/kumiko-bundled-features@0.383.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.383.0

## 0.382.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.382.0
  - @cosmicdrift/kumiko-framework@0.382.0
  - @cosmicdrift/kumiko-renderer@0.382.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.382.0
  - @cosmicdrift/kumiko-types@0.382.0

## 0.381.0

### Patch Changes

- Updated dependencies [0d2692f]
  - @cosmicdrift/kumiko-renderer@0.381.0
  - @cosmicdrift/kumiko-bundled-features@0.381.0
  - @cosmicdrift/kumiko-framework@0.381.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.381.0
  - @cosmicdrift/kumiko-types@0.381.0

## 0.380.0

### Patch Changes

- Updated dependencies [07ccdc9]
  - @cosmicdrift/kumiko-framework@0.380.0
  - @cosmicdrift/kumiko-types@0.380.0
  - @cosmicdrift/kumiko-bundled-features@0.380.0
  - @cosmicdrift/kumiko-renderer@0.380.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.380.0

## 0.379.0

### Minor Changes

- aa886cc: Fixes for the gaps the attack tests found: form drafts are encrypted per owner, SSE entity signals follow the read access of the connection, late Stripe events no longer roll a subscription back, unknown e-mail addresses count towards the login lockout, and cause details no longer leak when NODE_ENV is missing.
  
  <!-- kumiko-changes
  feature: form-draft
  type: breaking
  title: Form draft content is encrypted per owner
  detail: The jsonb field draft carries personal: { of: "ownerId" }, so its content is stored as ciphertext in events and in read_form_drafts; the delete event no longer keeps the plaintext in previous. The PII event backfill (jsonb-objects-v3) encrypts existing events once on the next boot and rebuilds the table. The column type stays jsonb, so there is no schema change.
  migration: Nothing to run; the backfill happens on boot. Code that reads read_form_drafts.draft with raw SQL must decrypt it (decryptPiiFieldValues) or use the form-draft lookup helpers; the get and list queries are unchanged for clients.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: PII backfill encrypts jsonb object and array fields
  detail: runPiiEventBackfill and backfillEventPiiEncryption now retro-encrypt plaintext jsonb objects and arrays of personal fields and personal jsonb scalars, and createPiiBackfillStateTable bootstraps under an advisory lock so concurrent first boots no longer skip the ALTER. Completed backfill states rerun once because the transform version changed.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: applyEntityEvent is exported from the db barrel, extension sources accept auto-verbs
  detail: applyEntityEvent can be used by extendEntityProjection apply handlers to project stored entity events of a foreign aggregate type. validateProjectionApplyKeys accepts the entity auto-verbs for an extension source that is not a registered entity.
  -->
  
  <!-- kumiko-changes
  feature: document-ingest-foundation
  type: fix
  title: documentExtract projection survives a rebuild
  detail: DOCUMENT_EXTRACT_AGGREGATE_TYPE is exported, and the documentExtract entity projection applies the stored document-extract.* events, so rebuildProjection restores the rows. No event is rewritten.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: SSE entity signals follow the read access of the connection
  detail: A signed-in connection receives an entity signal only when a query reading that entity lets one of its roles in (SseRouteOptions.entityReadAccess, built by collectEntityReadAccess). Entities without a reading query no longer go on the channel. When the reading access depends on a row or owner filter, the signal goes out without id and version, so a client refetches its query instead of learning which row changed.
  migration: Apps that rely on a signal for an entity no query exposes to the user must add a query for that entity with a matching access rule. Custom buildServer callers that build SseRouteOptions themselves must pass entityReadAccess.
  -->
  
  <!-- kumiko-changes
  feature: billing-foundation
  type: fix
  title: Late Stripe events are dropped
  detail: The Stripe plugin passes event.created as providerEventAt, process-event stores it as providerEventAtIso in the subscription event and drops a created, updated or canceled event that is older than one already stored (result stale: true). A canceled subscription is no longer reactivated by a late delivery. Providers without a timestamp are unaffected; no migration.
  -->
  
  <!-- kumiko-changes
  feature: tags
  type: fix
  title: assign-tag and delete-tag no longer race
  detail: Re-assigning a tag after it was deleted no longer restores the assignment of a gone tag. assign-tag and delete-tag now take the same per-tag advisory lock, so a parallel assign can no longer leave an assignment for a deleted tag.
  -->
  
  <!-- kumiko-changes
  feature: auth-email-password
  type: fix
  title: Unknown e-mail addresses count towards the login lockout
  detail: Failed logins for unknown or deleted addresses are counted under a keyed digest of the normalized address (ctx.rateLimitDigest, derived from the JWT secret), so after the threshold they answer account_locked like a registered address and the lock no longer reveals which addresses exist. Without a digest key the old invalid_credentials answer stays.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Cause details only with NODE_ENV development or test
  detail: internal_error responses and write error infos carry the cause snapshot (name, message, stack) only when NODE_ENV is explicitly development or test. A missing or misspelled NODE_ENV no longer exposes stack traces, paths or upstream URLs. kumiko-dev starts the server with NODE_ENV=development when none is set, so local dev keeps the details; a dev script that runs the server directly (bun --watch bin/server.ts) must set NODE_ENV=development itself to see them.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Global IP rate-limit middleware default matches runProdApp
  detail: globalIpRateLimit defaults to 600 requests per 60 seconds (was 1000). DEFAULT_GLOBAL_RATE_LIMIT is exported from the api barrel and shared with server-runtime. authEndpointRateLimit keeps its default of 5 per 60 seconds.
  migration: Apps that use globalIpRateLimit directly and relied on 1000 pass limit explicitly. runProdApp users see no change.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Boot warning when /metrics is off in production
  detail: buildServer logs a warning in production when no metrics option is set, which happens when PROMETHEUS_METRICS_TOKEN is unset.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Empty list with an active default filter offers "Show all"
  detail: A list that is empty only because its defaultFilters are on says so and offers a Show all button instead of the "create the first one" text. The hard-coded Loading… banners use the kumiko.widget.loading key, so they follow the locale.
  -->
  
  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: Translations for the default-filter empty state
  detail: kumiko.list.empty.defaultFiltered and kumiko.list.empty.showAll are translated in de, es, fr and it.
  -->
  
  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: improvement
  title: Retry documentation matches the client
  detail: The client retries 502, 503 and network errors; other 5xx and client timeouts fail at once because the render already ran. The feature description no longer promises a retry for every 5xx.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Count messages use singular and plural forms
  detail: Nine count messages (template usage, mail preview entries, layout origin and footer, tag delete confirmation, embedded-list paste warnings) now come as .one and .other keys in en, de, es, fr and it, so "1 template" no longer reads "1 templates". Apps that override these keys must rename them to .one and .other.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: fix
  title: runDevApp stop releases the late-bound revokers
  detail: stop() swaps the session and PAT revokers that boot bound onto the auth-mfa, sessions and personal-access-tokens feature instances for inert ones, and those features now accept a new binding on a second boot instead of keeping the first. A later app or test stack on the same feature instances no longer reaches the closed database connection.
  -->
- 434be6e: Four UI gaps from wave 3: an actionForm can load a singleton row, the dashboard text block gets a role-gated link, seeded PDF templates can carry an i18n title key, and the template overview shows locked tenant overrides.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: actionForm loads a singleton row without a record id
  detail: load.singleton: true on an actionForm sends the load query without idParam and prefills the form from the tenant's single row, like projectionDetail. A route id is never forwarded. The boot validator rejects singleton together with idParam.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Dashboard text block link shown only to given roles
  detail: A text block of kind link ({ text, screen, roles? }) renders a link to a screen and is hidden unless the user holds one of the roles. This only gates the display; the target screen still checks access on the server. The boot validator rejects an unknown target screen and an empty roles list.
  -->
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: seedSystemTemplate accepts titleI18nKey
  detail: A seeded template can store an i18n key as its title (titleI18nKey, exclusive with title). The overview returns the key; the document-designer overview, mail editor and PDF link modal translate it and fall back to the raw text. Templates without a key behave as before; no migration.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Template overview shows locked tenant overrides
  detail: Rows with lockedOverride and lockedOverrideI18nKey show the status text as a warning badge in the status column. The row action "Remove own version" calls the existing resetToSystem with the new overview field lockedOverrideId (the tenant row; one locale per click). The status shows a short label with the long sentence as tooltip.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: DataTable no longer hides its last column under the sticky actions column
  detail: Header and text cells wrap instead of staying on one line (badges, dates and row actions keep their own nowrap), and a row-action group wraps when the column is narrow. A table whose cells could not shrink scrolled sideways without a visible scrollbar and its last column slid under the sticky actions column. Long values now wrap (up to max-w-xs per column) instead of being cut with an ellipsis.
  -->

### Patch Changes

- 2a057b1: Template designer follow-up: plain-language titles for the template-resolver write handlers, a Spanish waitlist admin notice, and layout fixes in the editor rails and the shell header.
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Titles for the template-resolver write handlers
  detail: Every agent-callable template-resolver write handler now has a title in de, en, es, fr and it, so the AI assistant names actions such as "Edit template draft" instead of "template-resolver:write:patch-draft". The handlers of mounted content collections (`<id>-set`) stay untitled because their names depend on the app. The empty-field hint of the placeholder line editor now ends in an ellipsis inside the field instead of running past it.
  -->
  
  <!-- kumiko-changes
  feature: waitlist
  type: improvement
  title: Spanish admin notice for new waitlist entries
  detail: The operator notice "new entry on the waitlist" now exists in Spanish, like the entrant's confirmation. It follows the locale of the request that created the entry and falls back to English.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Designer rails wrap instead of clipping
  detail: A rail section wraps its action below the heading instead of clipping it, a resource name without spaces wraps inside its row instead of running under "Remove" and its meta text takes its own line instead of an ellipsis, the footer no longer offers a test mail when send-test-status says none can be sent, and the header label placeholder reads "e.g. Reminder" instead of an incident example. In a narrow window (1024px beside the app sidebar) both rails share the left column so the page keeps its room, and the header leaves save and publish to the footer below 1280px so the template title stays readable.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Shell header: the parent crumb no longer slides under a long title
  detail: The page title truncates on its own; the parent crumb stays whole and is left out when the space beside the header actions gets narrower than 20rem (a container query on the header's left side instead of the sm viewport breakpoint). The h1 carries the full title as tooltip.
  -->
- 5876d7b: Billing confirmation and termination receipt mails reach users again when PII encryption is active. The tests of the designer and renderer packages are now part of the root type check, and a DOM test no longer types into a form before its effects have run.
  
  <!-- kumiko-changes
  feature: billing-foundation
  type: fix
  title: Contract mails reach users with encrypted email addresses
  detail: With a KMS configured, the contract confirmation and the receipt for a termination from the user account used the stored, encrypted email address as recipient. The mail channel refuses such addresses, so neither mail was sent and the send job failed after its retries. Both now decrypt the address first; an erased user gets no mail, as before for deleted users.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Long template names wrap in the template overview
  detail: In the template overview, a long template name such as "Kündigungshinweis an den Betreiber" now wraps to a second line instead of widening the first column. The overview fits at 1280 px again when billing-foundation templates are listed.
  -->
- d72e1fc: The runtime of a feature file now follows from its path: `src/<feature>/web/**` is client code, everything else is server or isomorphic. The `@runtime` markers are gone from bundled-features and the document designer, and the isomorphic constants, i18n and name files moved under `web/`. Every existing export subpath stays valid and points at the new file.
  
  <!-- kumiko-changes
  feature: user-data-rights
  type: improvement
  title: Client files of a feature live under web/
  detail: Files that carried a runtime-client marker moved into <feature>/web/ (constants.ts, i18n.ts, qualified-names and similar), so the runtime-isolation guard reads the runtime from the path. Export subpaths such as ./tenant/constants are unchanged; only relative imports into the old file locations break. The web-side translation glue of user-data-rights, managed-pages, admin-shell, audit, jobs and the document designer is now web/default-translations.ts.
  migration: Run bun kumiko-upgrade --apply, or bun kumiko codemod feature-layout . --write. It moves every file marked as runtime client from src/features/<feature>/ into src/features/<feature>/web/, rewrites the relative imports and drops the marker. Add --check to list what is left.
  codemod: scripts/codemod/feature-layout.ts
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: App-feature-structure guard flags runtime-client markers
  detail: The guard reports a runtime-client marker in a feature file, outside web/ as client code in the server tree and inside web/ as redundant. dev/ is classified as the dev runtime by path.
  -->
- Updated dependencies [ba1a10e]
- Updated dependencies [ba1a10e]
- Updated dependencies [aa886cc]
- Updated dependencies [ba1a10e]
- Updated dependencies [2a057b1]
- Updated dependencies [5876d7b]
- Updated dependencies [ba1a10e]
- Updated dependencies [ba1a10e]
- Updated dependencies [ba1a10e]
- Updated dependencies [632da48]
- Updated dependencies [632da48]
- Updated dependencies [632da48]
- Updated dependencies [94d55c0]
- Updated dependencies [d72e1fc]
- Updated dependencies [ba1a10e]
- Updated dependencies [ba1a10e]
- Updated dependencies [ba1a10e]
- Updated dependencies [9d81e04]
- Updated dependencies [ba1a10e]
- Updated dependencies [7b01b0d]
- Updated dependencies [7b01b0d]
- Updated dependencies [ece210b]
- Updated dependencies [7b01b0d]
- Updated dependencies [ece210b]
- Updated dependencies [ece210b]
- Updated dependencies [ece210b]
- Updated dependencies [ece210b]
- Updated dependencies [ece210b]
- Updated dependencies [ece210b]
- Updated dependencies [ece210b]
- Updated dependencies [ece210b]
- Updated dependencies [ece210b]
- Updated dependencies [434be6e]
  - @cosmicdrift/kumiko-renderer@0.379.0
  - @cosmicdrift/kumiko-framework@0.379.0
  - @cosmicdrift/kumiko-types@0.379.0
  - @cosmicdrift/kumiko-bundled-features@0.379.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.379.0

## 0.378.0

### Minor Changes

- 2d7ee3e: Document PDFs can embed the images of a record
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Document PDFs embed the images of a record
  detail: A template variable of type images (templateVariable.images()) holds FileRef ids of the record. The new Images block (div[data-images], PDF templates only, rejected for mail kinds) renders them as data-URI images in the real PDF render. Only files of the rendering tenant are read, only png, jpeg, gif and webp, at most 24 images and 20 MB per document; missing, foreign, oversized or non-image ids are dropped silently. Previews and draft PDFs never read files and show one placeholder box per block. An images variable never renders as inline text. i18n keys template-resolver.documentEditor.images, template-resolver.documentEditor.imagesVariable and templateResolver.errors.document.imagesBlockPdfOnly ship in de, es, fr and it.
  migration: Declare a template variable with type `images`, place the Images block, and pass FileRef ids of the record in `variables`. Images resolve only in the real PDF render, previews show placeholders. The ids must come from the record on the server, never from client input: a resolved id is read for the whole tenant without an entity access check.
  -->
- a08f6d6: Only the SystemAdmin edits templates by default. An app unlocks TenantAdmins per kind and slug with `createTemplateResolverFeature({ tenantEditable: [{ kind, slug, access }] })`; reading and delivery are unchanged. Template collections without an `access` rule are SystemAdmin-only. The document designer takes `createDocumentDesignerFeature({ access })` for its editor screens, and `composeRendererStack` passes `templateResolver` options through.
  
  <!-- kumiko-changes
  feature: template-resolver
  type: breaking
  title: Template editing is SystemAdmin-only unless the app unlocks it
  detail: Every tenant write handler, the overview and resource upload accept SystemAdmin only, plus the roles of the tenantEditable entries. A write on a template that is not unlocked fails with templateNotTenantEditable. The test send follows the same rule. For a non-SystemAdmin an unknown template id answers 403 like a locked one, so the response does not reveal whether it exists. Collections without an access rule default to SystemAdmin.
  migration: Where TenantAdmins must keep editing a template, pass tenantEditable to createTemplateResolverFeature, for example tenantEditable: [{ kind: "mail", slug: "billing:notify:invoice-issued", access: { roles: ["TenantAdmin"] } }]. Give template collections an explicit access rule if tenants should manage them.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: breaking
  title: Designer screens are SystemAdmin-only unless the app passes access
  detail: The templates screen, layout, PDF and mail editors are visible to SystemAdmin only by default. createDocumentDesignerFeature takes an optional access rule whose roles are added.
  migration: Pass createDocumentDesignerFeature({ access: templateEditAccess(tenantEditable) }) with the same entries given to the template resolver when TenantAdmins edit templates.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: composeRendererStack forwards templateResolver options
  detail: RendererStackOptions.templateResolver is passed to createTemplateResolverFeature, so an app can set tenantEditable.
  -->
- 6352d97: The pre-push shim no longer executes a `kumiko-pre-push` from an untrusted ancestor. The upward walk ends at `$HOME` (inclusive) and skips ancestors owned by another user or writable by group or others, such as `/tmp`.
  
  `@cosmicdrift/kumiko-framework/search` exports `collectSearchableFieldNames` and `configureTenantSearchIndex`, so apps stop copying the per-tenant index setup. `@cosmicdrift/kumiko-server-runtime` exports `diskFileRoute`, an anonymous GET route that serves allowlisted disk files with ETag and 304. `@cosmicdrift/kumiko-renderer/flow-diagram` exports `renderFlow` and the `FlowSpec` types for static animated SVG flow diagrams.
  
  Stock caps reserve atomically under a per-tenant advisory lock, so two parallel writes can no longer both pass the cap. The document designer ships its own stylesheet, disables Upload when the files feature is not mounted, and disables the test mail with a hint when the server cannot resolve an address (new `send-test-status` query).
  
  <!-- kumiko-changes
  feature: guards
  type: fix
  title: Pre-push shim skips untrusted ancestors and stops at $HOME
  detail: The shim walked up to / and could exec a kumiko-pre-push planted in /tmp or another shared directory. The walk now ends at $HOME and skips ancestors that another user owns or that group or others can write to.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Search index setup helpers
  detail: collectSearchableFieldNames(registry) returns the deduplicated searchable fields of all entities and configureTenantSearchIndex(adapter, registry, tenantId) configures a tenant index with them, both exported from the search entry.
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: diskFileRoute for allowlisted disk files
  detail: diskFileRoute({ path, resolveFile }) returns an anonymous GET extra route with a :file parameter. resolveFile maps the raw name to a disk path or null for 404; the file is served with mime type, ETag and 304 handling.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: flow-diagram subpath
  detail: "@cosmicdrift/kumiko-renderer/flow-diagram" exports renderFlow(spec) and the FlowSpec, FlowNode, FlowEdge, FlowIcon types, a pure string function that renders an animated SVG flow diagram.
  -->
  
  <!-- kumiko-changes
  feature: cap-counter
  type: fix
  title: Stock caps are atomic under parallel writes
  detail: withStockCap now takes a transaction-scoped advisory lock per tenant and cap, so concurrent creates cannot both pass the check and exceed the cap.
  -->
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: send-test-status query for the template test mail
  detail: template-resolver:query:send-test-status answers whether a test mail can be sent (canSend) and, if not, why (no_channel or no_address), so clients can disable the action instead of failing on send.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Stylesheet export for the designer
  detail: "@cosmicdrift/kumiko-document-designer/web/styles.css" registers the designer's own Tailwind sources. Apps that embed the designer import it after the renderer stylesheet.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Upload and test mail follow the server's capabilities
  detail: Upload is disabled with a hint when the files feature is not mounted, and the test mail button is disabled with a hint when the server has no email channel or no address for the user.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: Renderer stylesheet no longer scans the document designer
  detail: The renderer stylesheet stopped scanning the document designer sources by relative path, which broke in isolated installs.
  migration: Apps that embed the document designer add `@import "@cosmicdrift/kumiko-document-designer/web/styles.css";` after the renderer stylesheet import in their styles.css.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: TenantDb.advisoryXactLock
  detail: ctx.db.advisoryXactLock(namespace, key) takes a transaction-scoped pg_advisory_xact_lock keyed on the handle's own tenantId plus key, so tenants never contend and the caller cannot pick another tenant. It needs no unsafeRaw grant.
  -->
  
  <!-- kumiko-changes
  feature: cap-counter
  type: improvement
  title: withStockCap no longer widens the handler's grants
  detail: withStockCap serialises through TenantDb.advisoryXactLock instead of ctx.db.unsafeRaw(), so wrapped handlers no longer receive an implicit unsafeRaw grant.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Boot check for projectionList writeHandler actions
  detail: Boot now rejects projectionList rowActions and toolbarActions of kind writeHandler whose handler is not a registered write-handler QN. Such actions only failed on click before.
  migration: Fix the handler QN to "<feature>:write:<short>" of a handler declared via r.writeHandler(...), or remove the action. Apps that fail to boot name the screen and action id in the error.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: fix
  title: Pre-push shim also vets node_modules/.bin
  detail: The shim now requires node_modules/.bin itself to be owned by the user and not group or world writable before executing kumiko-pre-push from it, in the guards hook and the dev-server husky template.
  -->

### Patch Changes

- f47cbd1: Files fields show download and PDF preview on detail screens
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Files fields show download and PDF preview
  detail: A read-only detail field with renderer { format: "file" } (projectionDetail, readOnly edit field) lists each file with its name and a download link; PDFs get an inline preview toggle. New optional primitive FileValueList, and PdfPreview (moved here from the document designer) with a per-source bounded document cache so several PDFs can share a page. i18n keys kumiko.field.file-list.download/preview/hidePreview and kumiko.widget.pdf-preview.* ship in de, es, fr and it.
  migration: PdfPreview is now exported from @cosmicdrift/kumiko-renderer/web (props: source {base64}|{url}, testId).
  -->
- ddb9d3d: The mail preview fills the editor column instead of a fixed 560px box
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Mail preview fills the editor column
  detail: The preview frame (HTML and plain text) had a fixed height of 560px, so long mails were cut off mid-sentence with an empty grey area below. The frame now grows with the center column (at least 420px) and scrolls inside.
  -->
- Updated dependencies [2d7ee3e]
- Updated dependencies [ebdac5c]
- Updated dependencies [f47cbd1]
- Updated dependencies [0250376]
- Updated dependencies [bde6050]
- Updated dependencies [a08f6d6]
- Updated dependencies [a08f6d6]
- Updated dependencies [a08f6d6]
- Updated dependencies [6352d97]
  - @cosmicdrift/kumiko-types@0.378.0
  - @cosmicdrift/kumiko-framework@0.378.0
  - @cosmicdrift/kumiko-bundled-features@0.378.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.378.0
  - @cosmicdrift/kumiko-renderer@0.378.0

## 0.377.0

### Patch Changes

- c00af64: kumiko-headless moves into kumiko-renderer as `@cosmicdrift/kumiko-renderer/headless` and kumiko-dispatcher-live as `@cosmicdrift/kumiko-renderer/live`. The old packages stay as deprecated re-export shims until the consumer pass of wave 4. The `package-merge` codemod rewrites imports and package.json dependencies for both moves.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: headless and the live dispatcher moved into renderer
  detail: The headless UI logic is exported from @cosmicdrift/kumiko-renderer/headless (with /headless/apex, /headless/dispatcher and /headless/locale-routing), the HTTP dispatcher from @cosmicdrift/kumiko-renderer/live. @cosmicdrift/kumiko-headless and @cosmicdrift/kumiko-dispatcher-live now only re-export these subpaths and are removed after the consumer pass of wave 4.
  migration: Run bun kumiko-upgrade --apply, or bun kumiko codemod package-merge . --write. It rewrites imports of @cosmicdrift/kumiko-headless (and its subpaths) to @cosmicdrift/kumiko-renderer/headless and imports of @cosmicdrift/kumiko-dispatcher-live to @cosmicdrift/kumiko-renderer/live, and replaces both dependencies in package.json with kumiko-renderer.
  codemod: scripts/codemod/package-merge.ts
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: package-merge codemod covers headless and dispatcher-live
  detail: The mapping table of the package-merge codemod gained the headless and dispatcher-live moves into kumiko-renderer.
  codemod: scripts/codemod/package-merge.ts
  -->
  
  <!-- kumiko-changes
  feature: headless
  type: improvement
  title: kumiko-headless is a deprecated shim over kumiko-renderer/headless
  detail: The package only re-exports @cosmicdrift/kumiko-renderer/headless and its subpaths and is removed after the consumer pass of wave 4.
  migration: Import from @cosmicdrift/kumiko-renderer/headless, or run bun kumiko codemod package-merge . --write.
  -->
  
  <!-- kumiko-changes
  feature: dispatcher-live
  type: improvement
  title: kumiko-dispatcher-live is a deprecated shim over kumiko-renderer/live
  detail: The package only re-exports @cosmicdrift/kumiko-renderer/live and is removed after the consumer pass of wave 4.
  migration: Import from @cosmicdrift/kumiko-renderer/live, or run bun kumiko codemod package-merge . --write.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: renderer-boundaries guard scans headless and live for imports only
  detail: The headless and live subtrees of kumiko-renderer must not import react-dom, jsdom or renderer-web; the symbol and JSX rules of the shared layer no longer apply to them. The section-fields-raw scope follows the moved headless sources.
  -->
- c00af64: kumiko-renderer-web moves into kumiko-renderer as `@cosmicdrift/kumiko-renderer/web` (with `/web/styles.css` and `/web/theme-plugin`). The old package stays as a deprecated re-export shim until the consumer pass of wave 4. The `package-merge` codemod rewrites imports, package.json dependencies and, new, CSS `@import`/`@plugin`/`@config` specifiers.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: renderer-web moved into renderer
  detail: The web bindings are exported from @cosmicdrift/kumiko-renderer/web, the stylesheet from @cosmicdrift/kumiko-renderer/web/styles.css and the Tailwind theme plugin from @cosmicdrift/kumiko-renderer/web/theme-plugin. @cosmicdrift/kumiko-renderer-web now only re-exports these and is removed after the consumer pass of wave 4.
  migration: Run bun kumiko-upgrade --apply, or bun kumiko codemod package-merge . --write. It rewrites imports and CSS @import lines of @cosmicdrift/kumiko-renderer-web (including /styles.css and /theme-plugin) to @cosmicdrift/kumiko-renderer/web and replaces the dependency in package.json with kumiko-renderer.
  codemod: scripts/codemod/package-merge.ts
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: package-merge codemod covers renderer-web and CSS files
  detail: The mapping table of the package-merge codemod gained the renderer-web move into kumiko-renderer/web, and the codemod now also rewrites .css files (@import, @plugin, @config). A @source path into the old package is reported for manual follow-up.
  codemod: scripts/codemod/package-merge.ts
  -->
  
  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: kumiko-renderer-web is a deprecated shim over kumiko-renderer/web
  detail: The package only re-exports @cosmicdrift/kumiko-renderer/web and its theme-plugin, and its styles.css imports the new stylesheet. It is removed after the consumer pass of wave 4.
  migration: Import from @cosmicdrift/kumiko-renderer/web, or run bun kumiko codemod package-merge . --write.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: renderer-boundaries guard leaves the web subtree unscanned
  detail: renderer/src/web may use the DOM and every web dependency; the shared renderer root and headless/live must not import it. The tailwind-scan-surface guard follows the new stylesheet location through package exports and shim imports.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: comment-lang touched mode pairs renames
  detail: The touched mode diffs a moved file against its old path, so moving a file no longer counts every German comment in it as new.
  -->
  
  <!-- kumiko-changes
  feature: cli
  type: fix
  title: project rebuild keeps blind indexes and aborts without crypto, events prune names its aggregate types
  detail: `kumiko project rebuild` now wires the subject KMS and blind-index key from the env like `schema apply` and `ops backfill-pii`, so rebuilding a PII projection no longer nulls its bidx columns. Without the crypto env an app with PII fields aborts the rebuild unless `--allow-plaintext-pii <reason>` is passed. `kumiko events prune` takes the required `--aggregate-types <a,b>` flag; before, it always failed because pruneEvents needs explicit aggregate types.
  -->
- Updated dependencies [ae10fa6]
- Updated dependencies [e552c13]
- Updated dependencies [e3ecf83]
- Updated dependencies [c00af64]
- Updated dependencies [60a29a8]
- Updated dependencies [9400d43]
- Updated dependencies [c00af64]
- Updated dependencies [c00af64]
- Updated dependencies [fd450c2]
  - @cosmicdrift/kumiko-bundled-features@0.377.0
  - @cosmicdrift/kumiko-renderer@0.377.0
  - @cosmicdrift/kumiko-framework@0.377.0
  - @cosmicdrift/kumiko-types@0.377.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.377.0

## 0.376.0

### Patch Changes

- Updated dependencies [05ba6c5]
- Updated dependencies [5274ebc]
- Updated dependencies [6a15526]
- Updated dependencies [e3e3faa]
  - @cosmicdrift/kumiko-bundled-features@0.376.0
  - @cosmicdrift/kumiko-types@0.376.0
  - @cosmicdrift/kumiko-framework@0.376.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.376.0
  - @cosmicdrift/kumiko-headless@0.376.0
  - @cosmicdrift/kumiko-renderer@0.376.0
  - @cosmicdrift/kumiko-renderer-web@0.376.0

## 0.375.0

### Minor Changes

- 4ca58ad: Template preview and test mail can render with chosen values
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Preview and test mail render with the values of a picked record
  detail: `template-resolver:query:preview` and `template-resolver:write:send-test` accept an optional `variables` object that replaces the declared example values for the named variables. The values are checked against the template's variable schema like a real send (unknown names and wrong types are rejected as `variables.<name>` validation errors); variables not passed keep their example. The mail editor now passes the values picked through the preview record picker into the preview and the test mail instead of only listing them.
  -->

### Patch Changes

- Updated dependencies [4ca58ad]
- Updated dependencies [5c7b19e]
  - @cosmicdrift/kumiko-bundled-features@0.375.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.375.0
  - @cosmicdrift/kumiko-renderer@0.375.0
  - @cosmicdrift/kumiko-renderer-web@0.375.0
  - @cosmicdrift/kumiko-framework@0.375.0
  - @cosmicdrift/kumiko-headless@0.375.0
  - @cosmicdrift/kumiko-types@0.375.0

## 0.374.0

### Patch Changes

- Updated dependencies [40b8667]
- Updated dependencies [de5d674]
- Updated dependencies [47e3a05]
- Updated dependencies [926e08e]
- Updated dependencies [1d72366]
- Updated dependencies [c3df9a2]
- Updated dependencies [1b710f1]
- Updated dependencies [8e735ed]
- Updated dependencies [fc221ab]
  - @cosmicdrift/kumiko-types@0.374.0
  - @cosmicdrift/kumiko-framework@0.374.0
  - @cosmicdrift/kumiko-headless@0.374.0
  - @cosmicdrift/kumiko-renderer@0.374.0
  - @cosmicdrift/kumiko-renderer-web@0.374.0
  - @cosmicdrift/kumiko-bundled-features@0.374.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.374.0

## 0.373.0

### Patch Changes

- Updated dependencies [6913834]
- Updated dependencies [6913834]
  - @cosmicdrift/kumiko-framework@0.373.0
  - @cosmicdrift/kumiko-types@0.373.0
  - @cosmicdrift/kumiko-bundled-features@0.373.0
  - @cosmicdrift/kumiko-headless@0.373.0
  - @cosmicdrift/kumiko-renderer@0.373.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.373.0
  - @cosmicdrift/kumiko-renderer-web@0.373.0

## 0.372.0

### Patch Changes

- 7c04d2a: Designer shows placeholder labels instead of raw names
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: The designer names placeholders by their label everywhere
  detail: Placeholder chips in the mail subject, the header label, the footer note and the paper editor now show only the variable's label; the raw name stays available as a tooltip. The tone select reads "From placeholder: <label>" instead of "{{tone}}", and the validation notes in the preview list labels instead of names. The file-name hint in the settings is translated (de, en, es). Unknown placeholders and variables without a label still show their name.
  -->
- 7c04d2a: Designer sample values show money and dates like the rendered mail
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Sample values show formatted money and dates
  detail: The sample-values bar in the mail preview formats money, dates and percentages in the language of the selected tab and with the tenant currency, through the same helpers the mail and PDF renderers use (formatDocumentMoney, formatDocumentDate and formatDocumentPercent, now exported from kumiko-headless). An amount reads "1.284,50 €" instead of "128450 EUR". The required star in the placeholder list stays on the label's last word instead of wrapping onto its own line. config/web now exports ConfigQueries.
  -->
- 5cd8710: Empty values use one placeholder everywhere
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Empty values use one placeholder everywhere
  detail: Empty table cells, reference columns, read-only fields and dashboard lists now share one em dash placeholder (exported as EMPTY_VALUE_PLACEHOLDER from the headless package) instead of mixing en and em dashes.
  -->
- Updated dependencies [a4401ab]
- Updated dependencies [de53a14]
- Updated dependencies [16ab9fe]
- Updated dependencies [7c04d2a]
- Updated dependencies [7c04d2a]
- Updated dependencies [7c04d2a]
- Updated dependencies [5cd8710]
- Updated dependencies [236858e]
- Updated dependencies [5cd8710]
- Updated dependencies [5cd8710]
- Updated dependencies [27b759f]
- Updated dependencies [5cd8710]
- Updated dependencies [5cd8710]
- Updated dependencies [5cd8710]
- Updated dependencies [221f81c]
- Updated dependencies [dca222d]
- Updated dependencies [2cb8b4f]
- Updated dependencies [5cd8710]
- Updated dependencies [7c04d2a]
- Updated dependencies [4224023]
- Updated dependencies [9bc4bc4]
- Updated dependencies [7c04d2a]
  - @cosmicdrift/kumiko-framework@0.372.0
  - @cosmicdrift/kumiko-bundled-features@0.372.0
  - @cosmicdrift/kumiko-headless@0.372.0
  - @cosmicdrift/kumiko-renderer@0.372.0
  - @cosmicdrift/kumiko-renderer-web@0.372.0
  - @cosmicdrift/kumiko-types@0.372.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.372.0

## 0.371.1

### Patch Changes

- 183d968: Document Designer client strings in Spanish
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: The Document Designer editor shows its own texts in Spanish
  detail: The client translation bundle of the Document Designer (canvas caption, origin bar, tenant customisations, resources, PDF settings, preview and validation messages) had only en and de, so Spanish users saw these texts in English. It now ships an es block that uses tú and the same terms as locale-es (organización, diseño, marcador). A parity test keeps the keys and placeholders of en, de and es aligned.
  -->
- @cosmicdrift/kumiko-bundled-features@0.371.1
  - @cosmicdrift/kumiko-framework@0.371.1
  - @cosmicdrift/kumiko-headless@0.371.1
  - @cosmicdrift/kumiko-renderer@0.371.1
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.371.1
  - @cosmicdrift/kumiko-renderer-web@0.371.1
  - @cosmicdrift/kumiko-types@0.371.1

## 0.371.0

### Patch Changes

- Updated dependencies [5a822b2]
  - @cosmicdrift/kumiko-bundled-features@0.371.0
  - @cosmicdrift/kumiko-framework@0.371.0
  - @cosmicdrift/kumiko-renderer@0.371.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.371.0
  - @cosmicdrift/kumiko-headless@0.371.0
  - @cosmicdrift/kumiko-renderer-web@0.371.0
  - @cosmicdrift/kumiko-types@0.371.0

## 0.370.0

### Minor Changes

- 2930518: Mail editor: informal German, tenant sender hint, readable button chips
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Designer addresses the user informally in German, points tenant-routed senders to Email sending and renders chips inside buttons
  detail: All German document designer strings use du like the rest of the framework; the formal locale overrides keep Sie. For a notification with tenantTransport the sender hint in the mail editor says the address comes from the tenant's Email sending settings and links to that screen when the app mounts it; TemplateUsageEntry gains tenantTransport. A placeholder chip inside a button block is now drawn in inverted colors so the button text stays readable in the editor.
  -->
- 2930518: Template variable labels can be i18n keys
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: templateVariable label accepts an i18n key; the designer shows the translation instead of the raw name
  detail: A label given as i18n key (templateVariable.text({ label: "billing:mail.variable.invoiceNumber" }) plus r.translations in each locale) is translated in the designer's variable rail, in the chips on the paper, in the steps and repeat block heads, in the placeholder, button, repeat and steps pickers of the editor toolbar and in the missing-variables footer; the raw variable name stays visible as tooltip. Plain-text labels keep working, a key without translation falls back to the key text. The server preview (sampleValuesFor, now with an optional labelText translator) names sample values by the translated label in the draft's locale. variableLabelMap in document-designer now takes the translator as first argument. VariableChips in the renderer takes optional labels.
  -->

### Patch Changes

- Updated dependencies [8ff5d19]
- Updated dependencies [a02e354]
- Updated dependencies [a02e354]
- Updated dependencies [79a0aa6]
- Updated dependencies [2930518]
- Updated dependencies [8ff5d19]
- Updated dependencies [4a6e151]
- Updated dependencies [a02e354]
- Updated dependencies [c051152]
- Updated dependencies [8ff5d19]
- Updated dependencies [75c45e4]
- Updated dependencies [2930518]
- Updated dependencies [2930518]
- Updated dependencies [2930518]
- Updated dependencies [7fa8420]
- Updated dependencies [8ff5d19]
  - @cosmicdrift/kumiko-framework@0.370.0
  - @cosmicdrift/kumiko-bundled-features@0.370.0
  - @cosmicdrift/kumiko-types@0.370.0
  - @cosmicdrift/kumiko-renderer@0.370.0
  - @cosmicdrift/kumiko-headless@0.370.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.370.0
  - @cosmicdrift/kumiko-renderer-web@0.370.0

## 0.369.0

### Patch Changes

- Updated dependencies [57c0cff]
- Updated dependencies [57c0cff]
- Updated dependencies [57c0cff]
- Updated dependencies [57c0cff]
- Updated dependencies [57c0cff]
- Updated dependencies [a4cab24]
  - @cosmicdrift/kumiko-bundled-features@0.369.0
  - @cosmicdrift/kumiko-types@0.369.0
  - @cosmicdrift/kumiko-framework@0.369.0
  - @cosmicdrift/kumiko-renderer@0.369.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.369.0
  - @cosmicdrift/kumiko-headless@0.369.0
  - @cosmicdrift/kumiko-renderer-web@0.369.0

## 0.368.0

### Patch Changes

- Updated dependencies [133ef08]
- Updated dependencies [39b5de4]
- Updated dependencies [1a1b772]
- Updated dependencies [fbc0759]
- Updated dependencies [7949df2]
- Updated dependencies [39b5de4]
- Updated dependencies [39b5de4]
- Updated dependencies [be3c6eb]
- Updated dependencies [be3c6eb]
- Updated dependencies [39b5de4]
- Updated dependencies [39b5de4]
- Updated dependencies [478ee1f]
- Updated dependencies [1404b33]
  - @cosmicdrift/kumiko-framework@0.368.0
  - @cosmicdrift/kumiko-bundled-features@0.368.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.368.0
  - @cosmicdrift/kumiko-types@0.368.0
  - @cosmicdrift/kumiko-renderer@0.368.0
  - @cosmicdrift/kumiko-renderer-web@0.368.0
  - @cosmicdrift/kumiko-headless@0.368.0

## 0.367.0

### Patch Changes

- f6b1803: Template conditions with data-if and a percent variable type
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Template conditions with data-if and a percent variable type
  detail: A paragraph, heading or table row with data-if="name" renders only when the variable has a value (0 counts as a value); inside a repeat row the name refers to the row field, on the repeat row itself to the root variable. The sanitizer keeps the attribute, and template validation reports a condition on an undeclared variable. New variable type percent (templateVariable.percent()) takes percentage points and renders locale-aware, 12 as "12 %" in German and "12%" in English; the preview uses its example value. The document designer has no toolbar control for conditions yet; the attribute survives editing.
  -->
- Updated dependencies [f6b1803]
- Updated dependencies [10de2c0]
- Updated dependencies [a0db2ac]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [04bf143]
- Updated dependencies [5f2cc2f]
  - @cosmicdrift/kumiko-bundled-features@0.367.0
  - @cosmicdrift/kumiko-renderer@0.367.0
  - @cosmicdrift/kumiko-renderer-web@0.367.0
  - @cosmicdrift/kumiko-types@0.367.0
  - @cosmicdrift/kumiko-framework@0.367.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.367.0
  - @cosmicdrift/kumiko-headless@0.367.0

## 0.366.0

### Patch Changes

- 7053800: The registrar takes one object per call: r.writeHandler, r.queryHandler, r.entity, r.requires and r.hook lose their positional forms
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Registrar methods take a single object, positional calls throw at registration
  detail: |
    r.writeHandler, r.queryHandler, r.entity, r.requires and r.hook now take one object. The positional overloads are gone from the types and throw when the feature is defined, with a message that points at the codemod. The throw is removed in the first release after 2026-10-29.
  
    writeHandler (queryHandler is the same shape):
      before: r.writeHandler("order:archive", schema, handler, { access });
      after:  r.writeHandler({ name: "order:archive", schema, handler, access });
  
    hook (type picks the handler shape, target is a name, a list or { allOf }):
      before: r.hook("postSave", "order", handler, { escapeHatch });
      after:  r.hook({ type: "postSave", target: "order", handler, escapeHatch });
  
    entity and requires:
      before: r.entity("order", definition, { table: ordersTable });  r.requires("auth", "tenant");
      after:  r.entity({ name: "order", ...definition, backingTable: ordersTable });  r.requires({ features: ["auth", "tenant"] });
  
    registerEntityCrud is no longer exported from @cosmicdrift/kumiko-framework/engine; call r.crud(name, entity, options) instead. The entity option { table } is now backingTable on the r.entity object and lands in the feature's entityTables, not in its entities. HookDefinition and EntityObjectDefinition are exported from @cosmicdrift/kumiko-types. Hook definitions are checked per type: validation takes no escapeHatch, phase only exists on postSave and postDelete, and { allOf } is not accepted on preSave.
  migration: Run `bun kumiko-upgrade --apply`. It rewrites every positional r.writeHandler, r.queryHandler, r.entity, r.requires, r.hook and registerEntityCrud call to the object form. Calls it cannot resolve statically (a spread argument, a registrar that is not typed as FeatureRegistrar) are listed as manual work with file and line; rewrite those by hand.
  codemod: scripts/codemod/object-form.ts
  manualAfterCodemod: true
  -->
- Updated dependencies [09d5344]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [a919906]
- Updated dependencies [15d76a8]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [8a7d835]
- Updated dependencies [7053800]
- Updated dependencies [3d58dea]
- Updated dependencies [49b3f10]
- Updated dependencies [5df8e3a]
- Updated dependencies [22b7f6e]
- Updated dependencies [7053800]
  - @cosmicdrift/kumiko-bundled-features@0.366.0
  - @cosmicdrift/kumiko-framework@0.366.0
  - @cosmicdrift/kumiko-types@0.366.0
  - @cosmicdrift/kumiko-renderer@0.366.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.366.0
  - @cosmicdrift/kumiko-renderer-web@0.366.0
  - @cosmicdrift/kumiko-headless@0.366.0

## 0.365.1

### Patch Changes

- Updated dependencies [93e1a7d]
- Updated dependencies [9a8abc9]
- Updated dependencies [34530bf]
- Updated dependencies [8633239]
- Updated dependencies [34530bf]
- Updated dependencies [34530bf]
  - @cosmicdrift/kumiko-framework@0.365.1
  - @cosmicdrift/kumiko-bundled-features@0.365.1
  - @cosmicdrift/kumiko-types@0.365.1
  - @cosmicdrift/kumiko-headless@0.365.1
  - @cosmicdrift/kumiko-renderer@0.365.1
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.365.1
  - @cosmicdrift/kumiko-renderer-web@0.365.1

## 0.365.0

### Patch Changes

- 45abe9d: The document designer names seeded mails, opens in the UI language and shows the built-in layout
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Seeded mails show readable titles and the editor opens in the UI language
  detail: A mail template without a stored title is named by its notification label (<feature>:notify.<name>.label) in the overview and the editor header instead of its slug. The mail editor opens on the UI language, or its base language, when the template has it, and falls back to the previous choice otherwise. The layout select offers the built-in standard layout when no default layout is stored, and the preview text field shows a hint while empty.
  -->
  
  <!-- kumiko-changes
  feature: auth-email-password
  type: improvement
  title: Auth mails carry designer labels
  detail: The feature registers <feature>:feature.label and notify labels for password-reset, account-unlock, email-verification, signup-activation and invite, so the document designer lists them by name. German and Spanish ship in the locale packages.
  -->
  
  <!-- kumiko-changes
  feature: user-data-rights
  type: improvement
  title: GDPR mails carry designer labels
  detail: Feature and notify labels for export-ready, export-failed, deletion-requested and deletion-executed name the GDPR mails in the document designer.
  -->
  
  <!-- kumiko-changes
  feature: billing-foundation
  type: improvement
  title: Contract mails carry designer labels
  detail: Feature and notify labels for contract-confirmation, contract-termination-receipt and contract-termination-operator-notice name the contract mails in the document designer.
  -->
  
  <!-- kumiko-changes
  feature: waitlist
  type: improvement
  title: Waitlist mails carry designer labels
  detail: Feature and notify labels for confirmation and admin-notice name the waitlist mails in the document designer.
  -->
- 72a5c9c: Document editors report null to onEditorReady when they are destroyed
  
  <!-- kumiko-changes
  feature: template-resolver
  type: breaking
  title: onEditorReady receives null when the editor is destroyed
  detail: DocumentTiptapEditor and PlaceholderLineEditor call onEditorReady(null) on destroy, so a held handle no longer points at a destroyed editor. The callback type is (handle: DocumentEditorHandle | null) => void. The document designer drops the handle of an unmounted field, so placeholder insertion no longer targets a destroyed editor.
  migration: A custom onEditorReady callback must accept null and drop its stored handle when it receives it.
  -->
- 6070813: Layout editor no longer asks for the platform override counts after a tenant save
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Layout editor no longer asks for the platform override counts after a tenant save
  detail: Saving or resetting a layout as tenant admin refetched the tenant-overrides query, which only the platform admin may read, so every save logged a 403. The reload now refetches it only for the platform admin.
  -->
- 45abe9d: Structured mails render as a card with a brand row, a toned chip and top line, a steps block and a footer band
  
  <!-- kumiko-changes
  feature: renderer-mail-html
  type: improvement
  title: Structured mail layouts render as a card with a footer band
  detail: The structured frame now draws a rounded white card with a border on the outer background. The top line sits inside the card, the footer region goes into a grey band at the bottom of the card, and the platform line from the footer resolver sits below the card. The in-code layout uses 640 px width and #ecedea as outer background and shows the tenant logo at 28 px height beside the tenant name, or an initial tile in the accent colour when no logo is set. Mail headings carry inline sizes (h1 30 px bold) and small text renders at 13 px. Existing structured layouts change their look accordingly; mjml layouts are unchanged.
  -->
  
  <!-- kumiko-changes
  feature: renderer-mail-html
  type: improvement
  title: Mail meta headerChip, tone and footerNote
  detail: A mail template can set meta.headerChip (a chip right of the brand row), meta.tone (accent, info, success, warning, danger or neutral; colours the chip, the top line of the card and the steps block) and meta.footerNote (a line above the site and unsubscribe links in the card band). All three accept placeholders and are rendered escaped; an unknown tone falls back to the accent colour. The band links the tenant site from the branding siteUrl next to the unsubscribe link. createRendererMailHtmlFeature({ brandSuffix }) adds a word after the tenant name in the brand row.
  -->
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Steps block in mail and PDF templates
  detail: The document editor offers a steps block in the toolbar block menu. It stores a fixed list of stages (value=label, at most 8) and the variable that names the current stage. Mail and PDF render it as a row of bars and labels; stages up to the current one are coloured, the current label is bold. Invalid blocks are dropped by the sanitizer and render nothing. Layout regions do not offer the block.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: composeRendererStack passes a mail brand suffix resolver
  detail: composeRendererStack({ mailBrandSuffix }) hands the resolver to createRendererMailHtmlFeature as brandSuffix.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Mail editor rail edits header chip, tone and footer note
  detail: The properties rail of the mail editor has a section "Kopf und Fuß" with the header chip and the footer note as placeholder lines and the tone as a select (accent, info, success, warning, danger, neutral). The values are saved in the mail meta and show in the preview right away. A tone stored as placeholder stays as its own option; the accent tone is stored as no tone. template-resolver/web exports MAIL_TONES and MailTone.
  -->
  
  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: improvement
  title: PDF steps block uses the branding accent colour
  detail: The steps block in a PDF document is coloured with the accent colour from the tenant branding, like in mails, and falls back to #1f5468 when no branding colour is set.
  -->
- b6b75fa: Layout validation waits for a pause in typing, quick mail uploads get distinct keys, and a failed system publish still reloads the editor
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Debounced layout validation, collision-free resource keys and reload after a half-finished system publish
  detail: The layout editor sent a validate query (with an MJML compile) on every change; it now waits 400 ms after the last edit. A second upload with the same file name before the row refetch finished reused the first key; keys handed out earlier are now remembered. When a SystemAdmin saved a mail version but publishing it failed, the editor kept the old state with the error shown; it now reloads so the stored version is visible.
  -->
- Updated dependencies [eef5ff1]
- Updated dependencies [84d7f1a]
- Updated dependencies [84d7f1a]
- Updated dependencies [eef5ff1]
- Updated dependencies [cd16f29]
- Updated dependencies [84d7f1a]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [7aa3223]
- Updated dependencies [eef5ff1]
- Updated dependencies [84d7f1a]
- Updated dependencies [84d7f1a]
- Updated dependencies [efa6253]
- Updated dependencies [84d7f1a]
- Updated dependencies [7e1b974]
- Updated dependencies [e4ecaba]
- Updated dependencies [ec7d696]
- Updated dependencies [efa6253]
- Updated dependencies [84d7f1a]
- Updated dependencies [eef5ff1]
- Updated dependencies [efa6253]
- Updated dependencies [45abe9d]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [81169ec]
- Updated dependencies [84d7f1a]
- Updated dependencies [efa6253]
- Updated dependencies [fbc6938]
- Updated dependencies [5a1cdc1]
- Updated dependencies [efa6253]
- Updated dependencies [eef5ff1]
- Updated dependencies [80e2132]
- Updated dependencies [72a5c9c]
- Updated dependencies [82dc9a4]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [eef5ff1]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [eef5ff1]
- Updated dependencies [2a33c8d]
- Updated dependencies [eef5ff1]
- Updated dependencies [eef5ff1]
- Updated dependencies [efa6253]
- Updated dependencies [59bbd15]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [84d7f1a]
- Updated dependencies [efa6253]
- Updated dependencies [45abe9d]
- Updated dependencies [45abe9d]
- Updated dependencies [5e5d83b]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [a546703]
- Updated dependencies [84d7f1a]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [5c276e6]
- Updated dependencies [21c5cbc]
- Updated dependencies [82dc9a4]
- Updated dependencies [fbc6938]
- Updated dependencies [efa6253]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [b6b75fa]
- Updated dependencies [b6b75fa]
- Updated dependencies [b6b75fa]
- Updated dependencies [b6b75fa]
- Updated dependencies [72a5c9c]
- Updated dependencies [0f8bff5]
- Updated dependencies [84d7f1a]
- Updated dependencies [067aa7b]
- Updated dependencies [fbc6938]
- Updated dependencies [efa6253]
- Updated dependencies [efa6253]
- Updated dependencies [eef5ff1]
- Updated dependencies [84d7f1a]
- Updated dependencies [84d7f1a]
- Updated dependencies [cd16f29]
- Updated dependencies [72a5c9c]
- Updated dependencies [2a33c8d]
- Updated dependencies [eef5ff1]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [84d7f1a]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [82dc9a4]
- Updated dependencies [72a5c9c]
  - @cosmicdrift/kumiko-bundled-features@0.365.0
  - @cosmicdrift/kumiko-framework@0.365.0
  - @cosmicdrift/kumiko-types@0.365.0
  - @cosmicdrift/kumiko-renderer@0.365.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.365.0
  - @cosmicdrift/kumiko-renderer-web@0.365.0
  - @cosmicdrift/kumiko-headless@0.365.0

## 0.364.0

### Minor Changes

- 68078ee: Editors and overview show an open draft beside the active version
  
  The editor header shows the served version (Active vN) next to the open draft (Draft vM), fed by the active field of find-by-id and layout-source; the template overview shows the draftVersion badge under the status of an active row.
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Editors and overview show an open draft beside the active version
  -->
- c181b3f: Document designer editors follow the approved board
  
  Mail-layout templates accept appearance meta (width, font, outer background, accent line, button style) that the mail renderer applies, and the layout-source query returns it. The layout editor uses the shared editor shell with one paper and one shared toolbar (`DocumentContentEditor` gains `toolbarHost`). Mail and PDF editors share frame, info bar, rails and footer.
  
  The unused `sender` key of mail template meta is gone from the editor; stored rows that still carry it are read without it, so they stay editable.
  
  Invalid template meta now reports per-field messages (`templateResolver.errors.template.meta.<field>.required|invalid`) instead of the parser text; the editors show them at the field. The `tenant-overrides` query additionally returns one row per customising tenant (name, status, version, changed at/by) and, with `diffTenantId`, the diff to the system version. A language without a version shows an empty state in the mail editor instead of a disabled editor.
  
  The `compileDocumentBody` option `resourceImageMaxWidthPx` caps resource images in mails (180 px). The `send-test` command takes `prefixSubject` (default true) to skip the `[TEST]` subject prefix, the template preview returns `mailLayout` (slug, scope, version of the layout used), and `RenderedMail` carries the layout ref.
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Document designer editors follow the approved board
  -->

### Patch Changes

- 8e81d73: PDF editor saves only the margins that are set; preview and error handling fixes
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: PDF editor keeps unset margins unset, frees old PDF previews, and shows reset and diff errors
  detail: Setting one margin no longer stores the other three as 15 mm, so the layout's header and footer margins still apply to them. The PDF preview no longer re-renders pages or stacks text layers on re-render and destroys the previous document. A failed reset to the system version shows an error banner in the PDF and mail editors, and a failing diff query shows an error state with retry instead of loading forever. The canvas reserves the footer margin like the renderer. Page formats, orientations and default margins now come from template-resolver (new exports PDF_ORIENTATIONS, PDF_DEFAULT_MARGIN_MM, PDF_HEADER_MARGIN_MM, PDF_FOOTER_MARGIN_MM, PdfOrientation).
  -->
- 15039ce: The layout editor counts the users of a layout on the server instead of from a page of 200 templates
  
  <!-- kumiko-changes
  feature: template-resolver
  type: fix
  title: template-resolver:query:overview accepts layoutSlug to list only the mails and PDFs using that layout
  detail: The optional layoutSlug payload field keeps only documents whose layout slug matches; total counts the filtered rows. Without it the response is unchanged.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Layout editor shows the real number of mails or PDFs using a layout
  detail: The editor asks the overview for the users of one layout (kind and layoutSlug filter) and takes the count from total, so a tenant with more than 200 templates no longer sees a too low usage number.
  -->
- 55f003d: Test isolation for the search payload warn spy and the mail editor placeholder rail
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Unit tests no longer leak a console.warn spy into later files
  detail: The search payload precedence tests spy on console.warn per test and restore it, so later files in the same --no-isolate worker start with the real console.warn. The mail editor missing-language test waits for the placeholder rail instead of reading it before the validate query settled.
  -->
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [a0dcd31]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [e9b032f]
- Updated dependencies [15039ce]
- Updated dependencies [cfbffba]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [6b1567e]
- Updated dependencies [2b255c2]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [92a9c52]
- Updated dependencies [fd5009a]
- Updated dependencies [8be3807]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [c181b3f]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [15039ce]
- Updated dependencies [fd5009a]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [b13c0d4]
- Updated dependencies [fd5009a]
- Updated dependencies [dfb2523]
- Updated dependencies [8fb6aa6]
- Updated dependencies [7482ee2]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [5a39305]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [7482ee2]
- Updated dependencies [f1b4367]
- Updated dependencies [fd5009a]
- Updated dependencies [15039ce]
- Updated dependencies [15039ce]
- Updated dependencies [15039ce]
- Updated dependencies [15039ce]
- Updated dependencies [e9b032f]
- Updated dependencies [15039ce]
- Updated dependencies [8be3807]
- Updated dependencies [22f40e1]
- Updated dependencies [5a2bea5]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [8e81d73]
- Updated dependencies [baf641a]
- Updated dependencies [8e81d73]
- Updated dependencies [92a9c52]
- Updated dependencies [15039ce]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [8be3807]
- Updated dependencies [8e81d73]
- Updated dependencies [15039ce]
- Updated dependencies [68078ee]
- Updated dependencies [15039ce]
- Updated dependencies [15039ce]
- Updated dependencies [b5a6395]
- Updated dependencies [fd5009a]
- Updated dependencies [55f003d]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
  - @cosmicdrift/kumiko-bundled-features@0.364.0
  - @cosmicdrift/kumiko-framework@0.364.0
  - @cosmicdrift/kumiko-types@0.364.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.364.0
  - @cosmicdrift/kumiko-renderer@0.364.0
  - @cosmicdrift/kumiko-renderer-web@0.364.0
  - @cosmicdrift/kumiko-headless@0.364.0

## 0.363.0

### Minor Changes

- f16183c: Mail editor screen with live preview and test mail

  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Mail templates open in a mail editor with preview and test mail
  detail: The "Edit" row action of a mail template opens the new mail-editor screen: subject, preview text and content with placeholders from the notification, logo and file attachments, PDF-template attachments, layout and category, sandboxed preview (HTML or text, desktop or 375 px), test mail to the signed-in user and the audit-based version list. PreviewRecordPickerProvider is an optional slot for a "pick a record" action in the preview.
  -->

- 3c6b3da: Template overview and layout editor

  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Overview and layout-source queries for the template designer
  detail: template-resolver:query:overview lists the mail, PDF and layout templates of the caller's tenant grouped by slug and kind (effective origin, locales, status, versions, layout slug, last change and the notifications that use it) and template-resolver:query:layout-source returns the header, signature and footer regions of a mail or PDF layout plus the locale a save has to use; a SystemAdmin also receives the MJML source of the system layout. The usage lookup is the exported collectTemplateUsage.
  -->

  <!-- kumiko-changes
  feature: managed-pages
  type: improvement
  title: Branding screen edits the logo file and readBranding returns logoFile
  detail: The branding settings screen has a logo upload for managed-pages:config:branding-logo-file, and readBranding and the branding query include logoFile next to logoUrl. The template resource errors template_resource_too_large and template_resource_unsupported_image have German and Spanish texts.
  -->

  <!-- kumiko-changes
  feature: admin-shell
  type: improvement
  title: includeDocumentDesigner lists the template navs in the admin workspaces
  detail: With includeDocumentDesigner, the tenant workspace shows document-designer:nav:templates and the platform workspace document-designer:nav:platform-templates. The option requires the document-designer feature and defaults to false.
  -->

  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Template overview, layout editor and an options object for documentDesignerClient
  detail: The package gains the server feature createDocumentDesignerFeature with the templates and platform-templates overviews and the layout-editor screen. documentDesignerClient now takes an options object instead of a screen id, and appLocales sets the languages column of the overview. The feature declares the pdf-template-editor screen (PDF_TEMPLATE_EDITOR_SCREEN_ID) and PDF rows open the PDF editor.
  -->

- 0a79504: Add the PDF template editor screen (`@cosmicdrift/kumiko-document-designer/web`): placeholder panel, page canvas with layout header and footer, page settings, validation footer and a pdf.js preview. The template-resolver document editor gains an `align` block, labelled placeholder chips, a repeat-table bar and an `onEditorReady` handle; `template-resolver/web` exports the qualified names; `renderer-puppeteer-client` exports `./qualified-names`; renderer-web's stylesheet scans the new package.

  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: New package with the PDF template editor screen
  detail: "@cosmicdrift/kumiko-document-designer/web" exports documentDesignerClient(screenId), PdfTemplateEditorScreen, PdfTemplateEditor and documentDesignerTranslations. The screen takes the template from the URL (?slug=...&locale=...), edits the system template for a SystemAdmin and a tenant customisation for everyone else, and previews the printed PDF with pdf.js. template-resolver/web additionally exports DocumentEditorHandle, TemplateResolverQueries, TemplateResolverHandlers and TemplateResolverErrors.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: uploadFileRef uploads a file to the stack and returns its FileRef id
  detail: uploadFileRef(file, target?) posts to /api/files with the CSRF header and returns the new FileRef id; it throws FileUploadFailedError carrying the server message when the endpoint sent one. FileUploadInput uses it with unchanged behaviour.
  -->

### Patch Changes

- Updated dependencies [9120f65]
- Updated dependencies [ef689d8]
- Updated dependencies [9120f65]
- Updated dependencies [045f886]
- Updated dependencies [a12e094]
- Updated dependencies [9120f65]
- Updated dependencies [b9a146d]
- Updated dependencies [9120f65]
- Updated dependencies [58452ae]
- Updated dependencies [ef689d8]
- Updated dependencies [a12e094]
- Updated dependencies [3c6b3da]
- Updated dependencies [09a4aa2]
- Updated dependencies [b022cca]
- Updated dependencies [fcd6eb4]
- Updated dependencies [2972bc2]
- Updated dependencies [2972bc2]
- Updated dependencies [2972bc2]
- Updated dependencies [ef689d8]
- Updated dependencies [4a748c3]
- Updated dependencies [0a79504]
- Updated dependencies [0a79504]
- Updated dependencies [2972bc2]
- Updated dependencies [f7da271]
- Updated dependencies [9120f65]
- Updated dependencies [7ed530a]
- Updated dependencies [d35e9a0]
- Updated dependencies [549a6f6]
- Updated dependencies [f3fe91e]
- Updated dependencies [3c6b3da]
- Updated dependencies [2972bc2]
- Updated dependencies [3c6b3da]
- Updated dependencies [46b83b8]
- Updated dependencies [cbed66e]
- Updated dependencies [366d89f]
- Updated dependencies [a12e094]
- Updated dependencies [9120f65]
- Updated dependencies [9120f65]
  - @cosmicdrift/kumiko-bundled-features@0.363.0
  - @cosmicdrift/kumiko-framework@0.363.0
  - @cosmicdrift/kumiko-types@0.363.0
  - @cosmicdrift/kumiko-renderer-web@0.363.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.363.0
  - @cosmicdrift/kumiko-renderer@0.363.0
  - @cosmicdrift/kumiko-headless@0.363.0
