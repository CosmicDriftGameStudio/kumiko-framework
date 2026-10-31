---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
---

Quoted text in HTML mails is folded again: the inbound sanitizer keeps the quote markers the reader looks for.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: Inbound HTML sanitizer keeps quote markers so the reader can fold quoted text
detail: The sanitizer stripped class and type attributes, so the reader never found the quote of Gmail, Apple Mail, Thunderbird, Yahoo or Outlook mails. It now keeps blockquote type="cite", the classes gmail_quote, moz-cite-prefix and yahoo_quoted on div and blockquote, and the ids appendonsend and divRplyFwdMsg on div; every other class, id and type is still removed. The reader's HTML quote detection also folds moz-cite-prefix and yahoo_quoted.
-->
