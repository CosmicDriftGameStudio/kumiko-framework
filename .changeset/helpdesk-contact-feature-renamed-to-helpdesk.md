---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
"@cosmicdrift/kumiko-framework": minor
"create-kumiko-app": minor
---

contact feature renamed to helpdesk

<!-- kumiko-changes
feature: helpdesk
type: breaking
title: contact feature renamed to helpdesk
migration: |
  The bundled feature contact is renamed to helpdesk; nothing keeps the old names. Imports: @cosmicdrift/kumiko-bundled-features/contact, /contact/web and /contact/client become /helpdesk, /helpdesk/web and /helpdesk/client; createContactFeature, contactOpenRequestsPanels, ContactOptions and the other Contact*/CONTACT_* exports become Helpdesk*/HELPDESK_* (createHelpdeskFeature, helpdeskOpenRequestsPanels, HelpdeskOptions). The feature name, handler, screen, config and i18n keys move from contact: to helpdesk:, the entities from contact-request/contact-reply to helpdesk-request/helpdesk-reply with the tables read_helpdesk_requests/read_helpdesk_replies, and error codes from contact_* to helpdesk_*. The browser client is served at GET /helpdesk/client.js and registers window.KumikoHelpdesk; update script tags, same-origin ingress paths and nav/legal references to the feature name. Notification preferences and opt-outs stored under contact:notify: are not carried over; the six notifications start with their defaults. Run kumiko schema generate and commit the migration. Data stored under the old names is not carried over: requests, replies and their events stay inert under contact-request/contact-reply, and the config values contact:config:reply-to and contact:config:telegram-chat are not read any more. Close open requests before upgrading and set reply-to and the Telegram chat again on the forwarding screen.
-->
