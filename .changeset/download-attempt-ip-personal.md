---
"@cosmicdrift/kumiko-bundled-features": patch
---

The source IP and user agent of rejected export-download attempts is now encrypted personal data. Job-path rows use the requesting user's key, anonymous token-path rows use the tenant key, and list-download-attempts still filters by IP through a blind index and returns plaintext IP and user agent.

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: download-attempt.ip and userAgent are encrypted personal data instead of plaintext
detail: |
  download-attempt.ip and userAgent are declared personal: { of: "attemptedByUserId", whenAbsent: "tenant" }, ip with find "exact" and userAgent with find "none". With a KMS configured, rows written by the logged-in job path are encrypted under the requesting user's key (a user forget makes IP and user agent unreadable), rows from the anonymous token path under the tenant key. The new ip_bidx column keeps the equality filter of list-download-attempts working across both kinds of rows, and the query now returns the decrypted values (an erased user's values come back as the erased sentinel). user-data-rights-defaults registers an EXT_USER_DATA hook for download-attempt: export lists the user's own attempts, delete purges the user's own attempts via the forget verb (projection row and blind index included, replayed on rebuild); owner-less token-path rows expire with the 90d hardDelete retention.
migration: |
  Apps that mount user-data-rights run kumiko-schema generate and apply: the migration adds the ip_bidx column and its index to read_download_attempts. Apps that mount user-data-rights without user-data-rights-defaults must register their own EXT_USER_DATA hook for the download-attempt entity, otherwise boot fails the PII hook coverage check. The annotation fingerprint of the boot PII backfill changes, so the first boot after the bump does one full pass: it encrypts existing download-attempt events (tenant key or user key) and rebuilds the projection including ip_bidx (KUMIKO_SKIP_PII_BACKFILL=1 turns it off).
-->
