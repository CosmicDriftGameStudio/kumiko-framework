---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Field prefix, suffix and fill action

`EditFieldSpec` takes `prefix` and `suffix` (an i18n key with the literal as fallback, or `{ field }` for the live value of another form field) and `fillAction` (`{ label, query, field, params? }`). The affixes render beside single-line text and number inputs. The fill button runs `query` with the form values picked by `params` and writes `result[field]` (string or number) into the field, which makes the form dirty and submits the value even on a `readOnly` field. A failed query or a result of another type shows an error under the field.

<!-- kumiko-changes
feature: framework
type: improvement
title: Boot checks for field affixes and fillAction
detail: Boot fails when a fillAction query is not a registered query handler, or when a { field } affix or a fillAction params source is not a field of the same form.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Input prefix, suffix and fill button
detail: Text and number inputs show prefix and suffix text, and a fillAction renders a button that fetches a suggestion into the field, also for a readOnly field. The Input primitive takes prefix, suffix and fill; renderer-web draws them beside the input.
-->
