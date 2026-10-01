---
"@cosmicdrift/kumiko-renderer-web": patch
---

Dotted select values keep their stored spelling in lists

An untranslated select value in a list cell fell back to a humanized slug, so "mobile.de" showed as "Mobile.de". Dotted values such as domains now stay as stored. Registered option translations are unaffected, and they work with dotted values.

<!-- kumiko-changes
feature: renderer
type: fix
title: Untranslated select values like "mobile.de" are no longer capitalized in list cells
-->
