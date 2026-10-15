---
"@cosmicdrift/kumiko-bundled-features": minor
---

Email channel has no renderer fallback

<!-- kumiko-changes
feature: channel-email
type: breaking
title: A notification without a mail template fails on the email channel
detail: The renderer option of createChannelEmailFeature is removed. A notification routed to the email channel without template + meta fails its delivery permanently with "has no mail template, declare template + meta on r.notification". r.notification declares no channels, so this is not checked at boot; an app's own mail tests over the inmemory transport catch it.
migration: |
  Drop the renderer option. Declare template + meta (or localizedTemplate) and variables on every r.notification that reaches the email channel, or accept that its email delivery fails. Run the app's notification tests after the bump: every email notification without a template now fails there.
-->
