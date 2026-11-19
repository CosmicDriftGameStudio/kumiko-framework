---
"@cosmicdrift/kumiko-bundled-features": patch
---

Embedded custom fields check every sub-field on write: money as integer minor units, enum against its values. A definition with a sub-type the write cannot check is refused.

<!-- kumiko-changes
feature: custom-fields
type: fix
title: Embedded custom fields check money and enum sub-fields
detail: set-custom-field skipped the value check of an embedded field as soon as one sub-field was not text, number, boolean or date. Now money sub-fields take an integer amount in minor units (the currency is the definition's top-level currency) and enum sub-fields only their declared values. define-tenant-field, define-system-field and update-tenant-field refuse an embedded definition whose sub-fields are not text, number, boolean, date, money or enum, an enum sub-field without values and a money sub-field without the definition's currency (400 validation_error). For API callers: send embedded money as { "fee": 1250 } (12.50 in the definition's currency), not as { amount, currency }; a value that used to pass unchecked now fails with 422 custom_field_value_invalid.
-->
