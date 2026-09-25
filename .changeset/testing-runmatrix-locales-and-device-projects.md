---
"@cosmicdrift/kumiko-testing": minor
---

`runMatrix` locales are app-injectable, and it gains a named-device project mode (fw#3118)

<!-- kumiko-changes
feature: testing
type: improvement
title: runMatrix locales are app-injectable via localeTags, and gains a namedDevice mode for phone-style device projects
detail: |
  runMatrix's locale list was fixed to en/de with hardcoded BCP47 tags.
  opts.localeTags lets an app supply its own locale -> tag map (e.g. "es" ->
  "es-ES"); locales with neither an app override nor the en/de default fall
  back to Intl.Locale(locale).maximize().region derivation, throwing only
  when no tag is derivable. A Playwright project whose name isn't a
  ViewportId but is a mobile/device project (offlot's "phone" project) now
  gets its own namedDevice output subtree
  (<dir>/<outputPrefix>/<name>/<locale>/<theme>/<viewport>.png) fixed to the mobile
  viewport, instead of incorrectly falling through to the desktop pass.
-->
