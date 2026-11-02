---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-samples": patch
---

The use-all-bundled sample app serves a public contact page that uses the real helpdesk browser client, with end-to-end tests for the real submit and the honeypot.

<!-- kumiko-changes
feature: helpdesk
type: improvement
title: helpdesk sample: complete same-origin contact page
detail: `samples/apps/use-all-bundled/public/helpdesk-contact.html` (with `.js` and `.css`) loads `/helpdesk/client.js`, builds the form from `load()` (kinds, optional phone), submits with proof of work and a hidden honeypot field and shows the sent, rate-limited and failed states. Two Playwright specs cover a real submit that reaches the SystemAdmin inbox and a honeypot submit that stores nothing.
-->
