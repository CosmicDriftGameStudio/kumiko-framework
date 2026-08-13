---
status: reference
verified: 2026-08-12
evidence: "kumiko-framework#1954"
---

# core-files: variant contract and security model

How image/file variants are generated, cached, and served — and the security
properties that keep the public route from becoming an open image proxy.
See `samples/recipes/files-post-processing` for a runnable walkthrough of all
three variant entry points described below.

## The variant contract: why the storage key is hashed from the spec

A variant request (`VariantSpec`: `fit`, `size`/`maxEdge`, `format`, `quality`,
`blur`, `blurRegions`) is never stored under a name you pick. The storage key
suffix is derived deterministically from the spec itself:

```
canonicalJson(spec) → sha256 → first 8 hex chars → `${name}-${hash}`
```

(`canonicalJson`/`specHash`/`variantSuffix` in
`packages/framework/src/derivatives/variant-key.ts`.)

This means:

- **The same spec always resolves to the same key**, regardless of which code
  path asked for it — a declarative field variant and an imperative
  `ctx.derivatives.variant()` call with an identical spec share one cached
  render.
- **Changing the spec changes the key.** There is no manual versioning scheme
  to invent or forget (no `@2x`, no `-v2` suffix bolted on by hand) — widen a
  crop or bump the quality and the new spec simply gets a new key, while the
  old rendered bytes stay valid under their own key until nothing references
  them.
- **The variant `name`** (`thumb`, `hero`, …) is a human label for a spec, not
  the cache identity. Two different specs registered under the same name in
  different places still land in different storage keys — there's no
  possibility of one overwriting the other's cached bytes.

## Three ways to generate a variant

1. **Declarative — `createImageField({ variants: { ... } })`.** The normal
   case: a profile picture, a hero image, a floor plan. The field definition
   *is* the whitelist — `resolveFieldVariant`
   (`packages/framework/src/derivatives/field-variants.ts`) looks up the
   requested name in the field's `variants` map via `Object.hasOwn`, so a
   variant name like `__proto__` is rejected as an unknown name rather than
   resolving through the prototype chain.
2. **Imperative — `ctx.derivatives.variant(fileRefId, spec, name)`.** For apps
   that track images as their own records rather than as a single field value
   — ordering, a chosen cover image, or region-blur where the blur
   coordinates come from runtime data (e.g. a detected face box) and can't be
   pinned down in a static field declaration. Same spec-hash key derivation
   as the declarative path, so a variant produced imperatively is just as
   cacheable.
3. **The public route with a predicate — the part people get wrong.** Covered
   next.

## The public route's three security properties

The bundled `file-derivatives` feature (only mounted when
`createFileDerivativesFeature({ resolveApexTenant })` is passed a host
resolver) exposes an **anonymous** `GET {basePath}/:fileRefId/:variant` route.
It is safe only because of three properties, all enforced together:

- **Named variants only, resolved against the field's own declaration.** The
  spec behind a requested name comes from `resolveFieldVariant`, the same
  helper the declarative path uses — the FileRef's `entityType`/`fieldName`
  locate the field, and the name must be an exact `Object.hasOwn` match in
  that field's `variants` map. There is no separate preset whitelist:
  `thumb`/`card`/`hero`/`full` (`.../file-derivatives/presets.ts`) are just
  ready-made specs an app can spread into its own `variants` declaration, not
  an allow-list the route checks against. Before this DB lookup, the route
  path param only passes a syntactic gate (`[a-z0-9-]{1,64}`, mirroring the
  UUID guard on `fileRefId`) to keep pathological input off the DB/rate-limit
  budget — it does not restrict which *declared* names are reachable. A field
  with no `variants` declared at all has nothing to serve here: every request
  against it answers a silent 404, same as an unknown `fileRefId` — no error,
  no log.
- **Never an externally-supplied spec.** The client sends a variant *name*
  only. The `VariantSpec` behind that name is always resolved server-side
  from the field's own `variants` declaration — there is no request shape
  that lets a caller hand the server an arbitrary crop/size/format to render.
- **Default-deny.** Serving requires an `EXT_DERIVATIVE_PUBLIC_PREDICATE`
  registered for the file's `entityType` that explicitly returns `true`
  (`r.useExtension(EXT_DERIVATIVE_PUBLIC_PREDICATE, "<entityType>", { isPublic })`).
  No registered predicate, or a predicate that returns `false`, means a 404 —
  never a degraded or partial response. An app opts individual entity types
  into public serving; nothing is public by default.

## Region-blur vs. whole-image blur vs. masking

- **Region-blur** (`spec.blurRegions`, imperative path only) blurs one or more
  rectangles given in coordinates relative to the *original* image's pixels,
  clamped to the image bounds before resize (`applyBlurRegions` in
  `packages/bundled-features/src/derivatives-sharp/render.ts`). Because the
  regions are runtime data — a detected face, a user-drawn box — this only
  makes sense from code, not from a static field declaration.
- **Whole-image blur** (`spec.blur`) is declarative — a single blur strength
  applied to the entire image after resize. This is the right tool when the
  blur itself is the point of the variant (a placeholder/preview blur), not a
  redaction of part of the image.
- **Masking** (cropping a rendered image to a shape — a circular avatar, a
  rounded card) is **not** a derivatives concern. It belongs in CSS
  (`border-radius`, `clip-path`) on the client, which is free and doesn't cost
  a render. The only exception is an image that leaves the app entirely with
  no CSS layer downstream — an exported PDF, an email attachment, a shared
  unstyled link — where baking the mask into the bytes server-side is the
  only option.

## The MIME extension point

Renderers register against a MIME pattern via
`r.useExtension(EXT_DERIVATIVE_RENDERER, "<mimePattern>", { render })`
(`packages/framework/src/engine/extension-names.ts`). Resolution tries an
exact match first, then falls back to a wildcard (`image/*`, registered by
the bundled `derivatives-sharp` feature for all raster image types). The
exact-match slot is there for renderers that don't fit the wildcard's
shape — a PDF-preview renderer (`application/pdf`, rendering a first-page
thumbnail) is the obvious next candidate, but nothing has registered that
slot yet. No feature currently calls `useExtension(EXT_DERIVATIVE_RENDERER,
"application/pdf", ...)` — a PDF `FileRef` today simply has no matching
renderer, exact or wildcard, so a variant request for it fails.

## Signed-URL default expiry

The framework-native file-download route signs URLs with a 15-minute default
expiry (`SIGNED_URL_DEFAULT_EXPIRY_SECONDS`,
`packages/framework/src/files/file-routes.ts`). That number is a deliberate
trade-off, not an arbitrary default: long enough that a download reliably
starts, short enough that a leaked URL (browser history, a screenshot, a
shared clipboard) isn't a long-lived credential.

## Storage tracking: counted now, enforced later

`filesStorageTrackingFeature` (`packages/framework/src/files/storage-tracking.ts`,
opt-in) counts bytes and file count per tenant from the event log — `fileRef`
create/delete/restore. Phase 1 is tracking-only: no hard limit, no upload
gatekeeping. This is a conscious deferred call, not an oversight — thresholds
get picked once production numbers exist to pick them against, rather than
guessed upfront. Apps that want a limit today read the counted row themselves
and decide what to do with it (a warning banner, a soft-throttle, billing).
