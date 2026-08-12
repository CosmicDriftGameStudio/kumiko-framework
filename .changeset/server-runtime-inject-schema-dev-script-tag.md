---
"@cosmicdrift/kumiko-server-runtime": patch
---

`inject-schema.ts` matched the client bundle's `<script src="/client.js">` tag with an exact string, so schema injection silently never fired in dev mode, where the tag carries an extra `type="module"` attribute. The match is now a regex that finds the tag by its `src` attribute regardless of what else is on it.
