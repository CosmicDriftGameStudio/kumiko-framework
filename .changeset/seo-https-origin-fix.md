---
"@cosmicdrift/kumiko-bundled-features": patch
---

seo: fix legal-pages/managed-pages URLs downgrading to http:// in sitemap.xml/llms.txt
behind a TLS-terminating reverse proxy (#979 follow-up) — `requestHost()` trusted the raw
request URL's scheme, which reflects the proxy's internal (plain HTTP) hop, not what the
client actually used. Now prefers `x-forwarded-proto` when present, falling back to the
raw URL scheme only for plain local dev without a proxy in front. Found by checking the
sitemap.xml of the two production apps (cashcolt.kumiko.rocks, publicstatus.eu) that
mount `seo` — both showed `http://` legal-pages entries next to correctly `https://`
app-supplied entries (those app callbacks hardcode `https://` themselves, masking the bug).
