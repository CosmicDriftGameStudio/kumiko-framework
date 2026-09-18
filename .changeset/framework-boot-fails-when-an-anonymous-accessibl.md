---
"@cosmicdrift/kumiko-framework": minor
---

Boot fails when an anonymous-accessible handler declares no rateLimit

validateAnonymousRateLimit (packages/framework/src/engine/boot-validator/entity-handler.ts) previously returned early when a handler declared no rateLimit at all, so an anonymous, internet-facing handler with zero throttling passed boot silently while one with a merely wrong bucket (rateLimit.per="user") was rejected. The check now runs for every handler whose access.roles includes "anonymous": it still skips openToAll handlers (they never admit anonymous) and rateLimit: { disabled: true, reason } declarations, but a handler with access.roles including "anonymous" and no rateLimit at all now throws at boot, naming the handler.

<!-- kumiko-changes
feature: framework
type: breaking
title: Boot fails when an anonymous-accessible handler declares no rateLimit
migration: |
  Every handler whose access.roles includes "anonymous" needs a rateLimit declaration: either rateLimit: { per: "ip" | "ip+handler", limit, windowSeconds } (per must not be "user"/"user+handler" — anonymous callers share user.id="anonymous", so a user-keyed bucket is a single global tap), or the documented exception rateLimit: { disabled: true, reason: "..." } for a handler that must not be rate-limited. This PR fixes the eight bundled-features handlers that tripped this at authoring time: compliance-profiles:query:sub-processors, template-resolver:query:by-slug, template-resolver:query:by-tenant, managed-pages:query:by-slug, managed-pages:query:by-tenant-published, managed-pages:query:branding, auth-email-password:query:signup-registration-status, seo:query:config.
-->
