---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-dispatcher-live": patch
---

propertyOf type guard and fewer unchecked casts in the UI packages

<!-- kumiko-changes
feature: renderer
type: improvement
title: propertyOf type guard and fewer unchecked casts in the UI packages
detail: "@cosmicdrift/kumiko-types/type-guards" exports propertyOf, which reads one property off an unknown value. Headless, renderer, renderer-web and dispatcher-live replace unchecked as-casts and globalThis probes with it and with narrowing. Behavior stays the same for well-formed input; a format spec, upload response or stream event with a wrongly typed property is now ignored instead of passed through.
-->
