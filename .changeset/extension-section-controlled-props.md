---
"@cosmicdrift/kumiko-renderer": minor
---

Fix #1888: `ExtensionSectionProps` gains `values`, `patch`, and `validate`,
mirroring the controlled-mode primitives from #1887. `RenderEdit` passes
through its own form snapshot and controller functions, so an extension
section mounted inside an `entityEdit` screen can read the host form's
current values (e.g. for a review step) and write to it (e.g. a VIN-decode
roundtrip that fills other fields) without a remount. All three are
`undefined` outside entityEdit sections (list-header and dashboard mounts).
