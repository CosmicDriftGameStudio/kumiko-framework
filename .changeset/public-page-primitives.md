---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Building blocks for public and wizard pages: clickable StepBar, success progress tone, StickyActionBar, CopyButton/ShareButton, PromoPanel, PhotoSlots and PublicShell

<!-- kumiko-changes
feature: renderer
type: improvement
title: Public-page building blocks (StepBar back navigation, sticky actions, copy/share, promo, photo slots, public shell)
detail: |
  StepBar takes `onStepSelect` (completed steps become buttons, so a wizard can jump back) and `narrowLayout` ("label" or "steps"); wizard forms wire it to jump back without validating. ProgressBar gains `tone: "success"`. New optional primitives: StickyActionBar (bottom-pinned action row with safe-area padding and an optional back action), CopyButton (clipboard with a copied state), ShareButton (`target: "whatsapp"` opens wa.me, `target: "system"` opens the share sheet and renders nothing where the browser has none, so pair it with a CopyButton) plus `buildWhatsAppShareUrl`, and PromoPanel (offer surface on its own `--color-promo*` tokens instead of an info banner). New widgets: PhotoSlots (one tile per required shot with thumbnail, per-slot upload and error, optional camera capture; UploadZone forwards `capture` too) and PublicShell (`variant` "marketing", "focus" with a progress slot, or "card"). The new primitives are optional in CorePrimitives, so existing registries keep compiling.
-->
