---
"@cosmicdrift/kumiko-renderer-mail-html": minor
---

Mail and PDF documents format dates and numbers by the template locale, dates in the long style

<!-- kumiko-changes
feature: renderer-mail-html
type: breaking
title: Documents format dates and numbers by the template locale, dates in the long style
detail: readDocumentFormat used the tenant setting tenant-settings:config:locale ahead of the template locale, so a German invoice of a tenant set to English printed "Oct 1, 2026" and "€780.00". Mails, mail previews and document PDFs now format by the locale of the template that is rendered; the tenant settings still supply the currency. The date helper prints the long style ("1. Oktober 2026", "October 1, 2026") instead of the medium style ("01.10.2026", "Oct 1, 2026").
migration: |
  Tests or snapshots that assert rendered dates change from "05.03.2026" to "5. März 2026" (de) and from "Mar 5, 2026" to "March 5, 2026" (en). A tenant that relied on tenant-settings:config:locale to change the number format of its documents now needs a template in that locale.
-->
