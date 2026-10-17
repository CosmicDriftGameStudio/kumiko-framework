---
"@cosmicdrift/kumiko-framework": patch
---

Content-type resolution no longer labels SVG and HTML fragments as XML

<!-- kumiko-changes
feature: framework
type: fix
title: SVG and HTML fragments are not resolved as application/xml
detail: For uploads without a concrete content type, markup without an XML declaration is only treated as application/xml when its root element is not a known HTML or SVG element (namespace prefixes ignored). SVG logos and HTML snippets no longer route to XML ingest providers.
-->
