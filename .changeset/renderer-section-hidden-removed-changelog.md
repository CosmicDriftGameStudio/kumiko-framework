---
"@cosmicdrift/kumiko-renderer": minor
---

`SectionProps.hidden` was documented as a released field (0.193.0 changelog), but no longer exists on the type: it was replaced by a dedicated `WizardStepGroup` primitive that owns the mount-but-hidden semantics for wizard steps (a hidden step stays mounted so its form state and any extension section's submit registration survive navigating away, instead of being lost on remount). This changeset only documents that migration; `WizardStepGroup` already shipped.

A consumer that set `hidden` directly on `Section` should move that usage to `WizardStepGroup`'s own `hidden` prop instead.
