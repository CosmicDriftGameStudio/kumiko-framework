---
"@cosmicdrift/kumiko-guards": patch
---

`no-framed-extension-sections` no longer flags a registered component that is only ever mounted as a dashboard custom panel or an entityEdit header slot

<!-- kumiko-changes
feature: guards
type: fix
title: no-framed-extension-sections now resolves the actual mount kind before flagging
detail: |
  extensionSectionComponents backs three different mount shapes: a
  kind: "extension" section (framed by the host's own Card/Section), a
  dashboard kind: "custom" panel, and an entityEdit slots.header slot. Only
  the section mount is actually framed, but the guard previously flagged
  every registered component that rendered its own Card/SectionCard/
  CollapsibleSection regardless of which of the three ways it was mounted,
  producing false positives for components that only ever render as a bare
  dashboard panel or header slot.
  The guard now scans every __component: SOME_CONST usage site across the
  scanned files (extending its scan to plain .ts files, not just .tsx, so
  screens.ts/feature.ts usage sites are actually seen), classifies each by
  its enclosing mount kind, and correlates it back to the registration via
  the shared registry key both sides reference by name. A component is only
  exempted when every usage site resolves to a custom panel and/or a header
  slot; a component used as a section anywhere, or whose usage sites cannot
  be classified at all, keeps today's conservative "stays flagged"
  behavior. List-header-slot mounts and footer/titleAction slots also keep
  the conservative behavior since this fix only covers the two shapes that
  produced real false positives.
  The scan now also covers plain .ts files on both the registration and the
  usage side, not just .tsx, so a registration declared inside a
  screens.ts/feature.ts file is checked for the first time. Checked against
  publicstatus and solon, the two consumers currently registering
  extensionSectionComponents from a .ts file: the fix does not add findings
  there, since their one Card-rendering registration is mounted exclusively
  as a kind: "custom" panel, which this guard now correctly exempts.
-->
