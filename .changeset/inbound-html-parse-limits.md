---
"@cosmicdrift/kumiko-bundled-features": patch
---

Inbound HTML is sanitized within a nesting and tag budget, and IMAP mails without a text part take their text from the sanitized HTML.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: Inbound HTML nested deeper than 1000 levels or with more than 250,000 tags is no longer sanitized
detail: The sanitizer tracks the elements the parser reports as open while it parses and stops past 1000 levels; the body then has no HTML view, keeps its text and its stored original, as with HTML over 500,000 bytes. Before, deep or tag-heavy HTML from any sender could hold the worker for minutes.
-->

<!-- kumiko-changes
feature: inbound-provider-imap
type: fix
title: IMAP mails without a text part get their text from the sanitized HTML
detail: mailparser no longer converts HTML to text and no longer inlines cid images as data: URLs. A mail without a text part takes its text and snippet from the sanitized HTML, also inside multipart/related or mixed, where it had none before; in a mixed mail with an HTML part and a text part the text covers both. HTML nested past the limit leaves the text empty and keeps the mail. Past 250,000 tags only the HTML before the 250,000th tag becomes text. The text also stays empty when the quote and list depth times the HTML length exceeds 5,000,000 characters, which stops a few hundred nested quotes from producing hundreds of megabytes of text.
-->
