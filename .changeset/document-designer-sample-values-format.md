---
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer-mail-html": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-document-designer": patch
---

Designer sample values show money and dates like the rendered mail

<!-- kumiko-changes
feature: document-designer
type: fix
title: Sample values show formatted money and dates
detail: The sample-values bar in the mail preview formats money, dates and percentages in the language of the selected tab and with the tenant currency, through the same helpers the mail and PDF renderers use (formatDocumentMoney, formatDocumentDate and formatDocumentPercent, now exported from kumiko-headless). An amount reads "1.284,50 €" instead of "128450 EUR". The required star in the placeholder list stays on the label's last word instead of wrapping onto its own line. config/web now exports ConfigQueries.
-->
