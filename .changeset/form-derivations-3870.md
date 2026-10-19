---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
---

actionForm can derive head totals from an embedded list

<!-- kumiko-changes
feature: framework
type: improvement
title: actionForm can derive head totals from an embedded list
detail: An actionForm screen declares `derive` for head fields: sum, subtract, multiply, percent over other fields, or listSum over one cell of an embedded list with an optional whenEmpty fallback. The renderer recomputes them live and shows them read-only; a listSum without whenEmpty becomes an input while the list is empty. withFormDerivations(schema, screen) recomputes them on the server before validation, so client totals are never trusted; boot fails when the handler schema is not wrapped with the screen's own derive. A field that only feeds a `whenEmpty` fallback is read-only while the lists have rows. New embedded derived op `percent` (from[0] * from[1] / 100).
migration: Add `derive` to the actionForm screen and wrap the handler schema with `withFormDerivations(schema, screen)`; new embedded derived op `percent`.
-->
