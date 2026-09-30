---
"@cosmicdrift/kumiko-bundled-features": patch
---

Mail stack on patched nodemailer 10, imapflow and mailparser

Bumps nodemailer to ^10.0.13 (GHSA-v53p-9fqp-m79j, high), mailparser to ^3.9.32 and imapflow to ^1.7.8 so no dependency pins a vulnerable nodemailer 9.x any more. nodemailer 10 ships its own types, so @types/nodemailer is dropped; it requires Node.js >= 20. No API change for kumiko apps.

<!-- kumiko-changes
feature: mail-transport-smtp
type: fix
title: Mail stack on patched nodemailer 10, imapflow and mailparser
-->
