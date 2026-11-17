---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

`enumOption` takes `optionsOf: "<feature>:<entity>.<field>"`, and boot checks that the field exists.

<!-- kumiko-changes
feature: renderer
type: improvement
title: enumOption names its select field with optionsOf
detail: `{ format: "enumOption", optionsOf: "orders:order.status" }` shows the option labels of that select or multiSelect field from the `<feature>:entity:<entity>:field:<field>:option:<value>` keys, so query columns no longer spell out the key prefix by hand. Boot fails with `screen/enum-option-label-source-invalid` when the field does not exist or is not a select or multiSelect field, and when an enumOption sets both or neither of `keyPrefix` and `optionsOf`. `keyPrefix` stays for labels outside the field-option convention. Columns of an entityList or relatedList on a select field already get their labels without a renderer.
-->
