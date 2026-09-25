---
"@cosmicdrift/kumiko-bundled-features": minor
---

file-derivatives: `publicTenantResolution: "fileRef"` serves public variants of every tenant over a shared host (fw#3255)

<!-- kumiko-changes
feature: file-derivatives
type: improvement
title: publicTenantResolution "fileRef" reads a public variant from its FileRef's own tenant
detail: |
  `createFileDerivativesFeature({ resolveApexTenant, publicTenantResolution: "fileRef" })`
  keeps resolveApexTenant as the host gate (an unknown host still 404s), but
  reads the variant in the tenant that owns the FileRef, so one shared
  platform host serves `/media/:fileRefId/:variant` for every tenant. The
  FileRef tenant's `isPublic` predicate stays the default-deny gate; unknown
  and non-public FileRefs answer the identical 404. Default "host" keeps the
  previous behavior. In "fileRef" mode the anonymous
  `file-derivatives:query:public-variant-by-file-ref` query is also reachable
  over `/api`, independent of the host, and returns only variants the
  predicate allows. Passing publicTenantResolution without resolveApexTenant
  throws at construction.
-->
