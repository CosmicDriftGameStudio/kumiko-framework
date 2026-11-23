---
"@cosmicdrift/kumiko-bundled-features": patch
---

Signature and letter PDFs are refused when their stream decoders, xref stream or page tree exceed fixed limits.

<!-- kumiko-changes
feature: signature
type: fix
title: Signature and letters refuse PDFs whose object streams need more than 16 MiB of decoder buffer, whose xref stream declares more entries than it holds, or whose page tree is too large
detail: `signature` request, its sweep and `letter-foundation` (`mergePdfs`, `checkPostalPdf`) load PDFs with limits. The decoders of object streams and xref streams may take at most 16 MiB of buffer per load (reached from about 8 MiB of decoded data on; a legitimate PDF with 2000 pages needs about 5 MiB). An xref stream may not declare more entries than its decoded bytes can hold. The page tree may have at most 20000 visited nodes, which stops cycles and fan-out over shared kids. A PDF over a limit is refused like an unreadable file (`document_not_a_pdf`, `documentUnreadable`, `unreadable`). pdf-lib calls outside these loads are unchanged.
-->
