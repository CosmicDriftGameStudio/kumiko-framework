---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": patch
---

An app footer-slot action can now opt into the wizard's sticky primary group (fw#1918 follow-up)

<!-- kumiko-changes
feature: renderer
type: fix
title: An app footer-slot action can opt into the wizard's sticky primary group
detail: |
  fw#1918 pinned the primary action into a sticky footer on mobile by checking
  each form-action element's `type === "submit"` prop. An app's
  `screen.slots.footer` renders through EditSlotMount, which never carries
  `type="submit"` (its button is opaque app code), so that slot always landed
  in the non-sticky secondary group even on a wizard's last step — regressing
  apps like offlot-app whose wizard-final "Publish" action lives in the footer
  slot. `ScreenSlots.footerPrimary?: boolean` now marks that slot as the
  sticky-primary action; `FormFooter` in kumiko-renderer-web recognizes it via
  the shared `STICKY_PRIMARY_ACTION_PROP` marker exported from kumiko-renderer.
  Built-in submit buttons are unaffected.
migration: |
  Additive — no action needed unless a footer-slot action must become the
  sticky primary action on mobile. Set `slots.footerPrimary: true` next to
  that screen's `slots.footer` registration to opt in.
-->
