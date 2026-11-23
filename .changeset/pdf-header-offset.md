---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

PDF uploads are accepted when bytes precede the `%PDF-` header within the first 1024 bytes.

<!-- kumiko-changes
feature: files
type: fix
title: PDFs with bytes before the header are no longer rejected
detail: Content sniffing looked for `%PDF-` only at byte 0, so PDFs from scanners and ERP exports that write a short preamble were rejected with `file_rejected`, although every reader opens them. The header may now start anywhere in the first 1024 bytes, as Acrobat allows. Files with another signature at byte 0 keep their type, and the serve path reads a 1028-byte prefix for the same check. Template attachments use the same sniffing, the PDF rasterizer accepts the same headers, and a generic mail attachment that looks like XML stays XML even when it quotes the header.
-->
