---
"@cosmicdrift/kumiko-renderer-web": patch
---

Unify screen padding across `PageSection` and `FormScreenShell` (fw#2640). Both now render the shared `screenPaddingClassName` (`px-6 pt-6 pb-12`) instead of `p-6` vs. `px-6 pt-6 pb-12`, so the footer inset below a custom screen or dashboard no longer depends on the screen type. Visible change: custom screens and dashboard screens gain 24px of bottom inset; form screens are unchanged.
