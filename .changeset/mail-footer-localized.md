---
"@cosmicdrift/kumiko-renderer-mail-html": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Mail footer texts come from the i18n system

<!-- kumiko-changes
feature: renderer-mail-html
type: breaking
title: Mail footer texts come from the i18n system
detail: The "Sent by" line of the default mail layout, the unsubscribe label and the imprint and privacy labels now come from the mail translations (mail.footer.sentBy, mail.footer.unsubscribe, mail.footer.imprint, mail.footer.privacy). English ships with the renderer, German and Spanish with locale-de and locale-es; an unknown locale falls back to its root language and then to English. MailFooterLink.label is optional and defaults to the framework text. The default layout renders the sender line through the new mailSentBy placeholder. MAIL_CHROME_EN exports the English source texts for translation tooling.
migration: Apps that send German or Spanish mails mount localeDe() or localeEs(), otherwise the footer labels are English. A mail layout already stored from the old default keeps its fixed "Sent by" text until it is reseeded or edited.
-->
