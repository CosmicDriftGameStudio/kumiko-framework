---
"@cosmicdrift/kumiko-framework": patch
---

Boot validation warns for every `file`, `image`, `files` and `images` field without a `personal` annotation. A forget with strategy `delete` keeps the binary of such a field and only severs the uploader link, so the stance has to be declared.

<!-- kumiko-changes
feature: framework
type: improvement
title: boot warning for file and image fields without a personal annotation
migration: |
  Mark fields that hold personal data with `personal: "self"` or `personal: { of: "<ownerField>" }`, and business data with `personal: false, reason: "is_business_data"`. Unannotated fields keep their binary on forget.
-->
