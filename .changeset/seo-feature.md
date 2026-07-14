---
"@cosmicdrift/kumiko-bundled-features": minor
---

seo: neues bundled-feature für SEO/AEO/GEO-Site-Discovery (#979) — `createSeoFeature`
mountet GET /sitemap.xml, /llms.txt und optional /robots.txt (merged aus app-eigenem
Callback + legal-pages + managed-pages), plus die additive OG/JSON-LD-Erweiterung für
`wrapInLayout` und die pure `organizationSchema`/`webPageSchema`/`faqPageSchema`-Builder
für `ApexHead.schemaJson`. `managed-pages` bekommt dafür die neue anonyme
`by-tenant-published`-Query. War Teil von #979, hatte aber kein Changeset — daher hier
nachgereicht, damit die Version tatsächlich published wird.
