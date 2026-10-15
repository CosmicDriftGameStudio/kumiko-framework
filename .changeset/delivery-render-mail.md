---
"@cosmicdrift/kumiko-bundled-features": minor
---

Email channel renders notification templates through ChannelContext.renderMail

<!-- kumiko-changes
feature: delivery
type: improvement
title: ChannelContext.renderMail renders template notifications for the email channel
detail: A notification that declares a template is rendered through the mail renderer plugin with the recipient locale and the notification variables; the email channel fails when renderMail is missing instead of falling back to the legacy renderer. The job path passes the tenant config accessor to the renderer, the inline path renders without one.
-->
