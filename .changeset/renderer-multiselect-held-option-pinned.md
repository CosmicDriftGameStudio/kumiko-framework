---
"@cosmicdrift/kumiko-renderer": patch
---

Multi-select options held at mount stay visible but fixed when unavailable; stored currency codes and mixed arrays render sensibly

<!-- kumiko-changes
feature: renderer
type: fix
title: A held multiSelect value that optionsAvailabilityQuery marks unavailable stays listed but cannot be removed
detail: The keep-listed set is taken from the values present when the field mounted, not from the live value. In the checkbox grid the entry is rendered disabled and select-all/deselect-all leave it as is; in the combobox a removal is merged back into the value. Previously unchecking such a role hid it for good while the write path kept it, so the form reported a removal that never happened. A stored lower-case currency code such as usd is normalised to upper case instead of falling back to the field currency, and array values with a non-string element keep their string entries instead of being treated as empty.
-->
