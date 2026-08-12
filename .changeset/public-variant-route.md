---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

New extension point `derivativePublicPredicate` (`file-derivatives`) lets an app declare, per entityType, whether a FileRef's derived variants are publicly readable: `r.useExtension(EXT_DERIVATIVE_PUBLIC_PREDICATE, "<entityType>", { isPublic: (args, ctx) => boolean | Promise<boolean> })`. No registration for an entityType is default-deny.

`createFileDerivativesFeature({ resolveApexTenant })` mounts an anonymous `GET /media/:fileRefId/:variant` route serving one of the 4 fixed presets (`thumb`/`card`/`hero`/`full`) — never the original, never an arbitrary spec, only after the registered predicate says yes. `tenantId` is resolved exclusively from the request's Host header via `resolveApexTenant`, never from the payload. An unknown FileRef, an unregistered/denying predicate, and an invalid variant name all answer identically (404) — no existence-leak via distinct status codes. Without `resolveApexTenant` the route stays unmounted, so existing `ctx.derivatives`-only consumers are unaffected.

Also fixes a latent bug affecting every feature-declared `r.httpRoute`: `rateLimit: {per: "ip"}` (and other IP-keyed limits) silently did nothing for handlers invoked through an `r.httpRoute`'s `systemQuery`, because those routes run outside `/api/*` and never passed through the middleware that populates the request's IP/requestId context. `r.httpRoute` handlers are now wrapped in the same request context, so IP-based rate limiting works for them too.
