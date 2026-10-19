---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer": minor
---

The billing plan catalog accepts an optional contact card, such as "Enterprise · Contact us", rendered as the last plan card without a price. PlanCard gains a ctaLink slot that renders a link instead of the cta button.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: Optional contact card in the billing plan catalog
detail: catalog.contact takes labelKey, benefits, actionLabelKey and an absolute https: or mailto: href. The billing-plans query returns it as contact, the billing-plans panel renders it as the last card without a price for every viewRole, also when the caller cannot purchase or billing is off. Boot validation rejects empty keys and any other href.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: PlanCard ctaLink
detail: PlanCard takes ctaLink ({ label, href, target? }) and renders it as a full-width link button in the footer instead of the cta button. The PlanCardLinkSlot type is exported from @cosmicdrift/kumiko-renderer/web next to PlanCardActionSlot.
-->
