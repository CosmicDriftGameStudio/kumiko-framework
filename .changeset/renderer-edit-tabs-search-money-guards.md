---
"@cosmicdrift/kumiko-renderer": patch
---

A tabs layout on a host with `Tabs` but no `WizardStepGroup` now falls back to a stacked form instead of throwing. After a server validation error the form jumps to the first tab that actually shows the errored field, skipping tabs where it is hidden. A delete handler that returns a non-error value no longer shows an empty error banner. The list search box keeps keystrokes typed while the parent echoes the previous search value late. A money value whose stored currency is not a three-letter code falls back to the field currency instead of crashing the screen. Embedded-list reference columns remount instead of breaking hook order when the column set changes. The wizard step check parses the form once per change instead of once per step.

<!-- kumiko-changes
feature: renderer
type: fix
title: Tabs fallback, error-tab jump, list search echo and money currency no longer misbehave
-->
