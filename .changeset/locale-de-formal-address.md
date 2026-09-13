---
"@cosmicdrift/kumiko-locale-de": minor
---

`localeDe()` and `localeDeClient()` now accept an optional `{ address: "informal" | "formal" }` option. The bundle still uses informal "du" by default, so existing consumers are unaffected. Apps that use formal "Sie" in their own copy (e.g. property-management apps) can pass `{ address: "formal" }` to get a "Sie" rendering of the ~98 framework texts that address the user directly, so the bundled framework copy no longer clashes with the app's own tone.
