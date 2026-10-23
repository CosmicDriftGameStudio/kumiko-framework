---
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-document-designer": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
---

The complexity guard now scans .tsx files with the same hard cap of 40 as .ts.

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
