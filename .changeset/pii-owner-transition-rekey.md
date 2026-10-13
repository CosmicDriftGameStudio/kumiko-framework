---
"@cosmicdrift/kumiko-framework": patch
---

Personal fields now follow the row's current owner. When an update moves the owner (none to X, or X to Y), the update event carries the personal fields under the new owner's key, so forgetting the new owner erases them. A new backfill option moves older tenant-keyed values under their owner. The boot backfill uses it in its one full pass per fingerprint.

<!-- kumiko-changes
feature: framework
type: fix
title: Personal fields are re-keyed to the new owner on owner change
detail: On absent to X and X to Y, the executor writes the personal fields (personal: { of: ownerField }) of the row under the new owner's key into the update event, so the projection, a rebuild and every event from the transition on agree and only the current owner's forget decides erasure. As a result <entity>.updated changes can contain personal fields the caller did not send. X to absent keeps the values under X so the last owner's forget still erases them. The created event from before an owner existed stays tenant-keyed in the immutable log. The new backfill option rekeyTenantKeyedOwnerFields moves such tenant-keyed values under the owner the projection or payload names (never via whenAbsent, a projection row of another tenant is ignored, other tenants' keys are not touched, a forgotten owner yields the erased sentinel). The boot PII backfill passes it, and its fingerprint now includes a transform version, so each deployment runs one full pass and afterwards only catch-up passes near the cursor. A created event whose owner transition happens after that full pass is not rescanned and stays tenant-keyed until someone runs backfillEventPiiEncryption(db, registry, { resolveOwnerFromProjection: true, rekeyTenantKeyedOwnerFields: true }) followed by a projection rebuild, or the transform version is bumped.
migration: No consumer code change. The boot backfill runs in the background (startPiiEventBackfillOnBoot, it does not block readiness, KUMIKO_SKIP_PII_BACKFILL=1 turns it off). On the first boot after the bump it does one full scan of kumiko_events and rebuilds the affected projections. Consumers reading updated.changes must not treat a personal field there as a user edit when the owner field changed in the same event.
-->
