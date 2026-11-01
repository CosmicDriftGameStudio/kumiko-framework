---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

A `readGate.fileOwner` row now also passes when its file belongs to a read-model entity (a projection entity) the viewer may read. Mail attachments count: a document filed from an attachment is visible to whoever may read the mail.

<!-- kumiko-changes
feature: framework
type: fix
title: readGate.fileOwner counts read-model entities as file owners
detail: A document whose file is attached to a projection entity (for example a mail attachment owned by `inbound-message`) was invisible to everyone but the framework system user, because only `r.entity` entities were owner candidates. Read-model entities with a file field now count, with the same rules as entities (no parentRef, no readGate, uuid ids, tenant scope, soft delete) plus two fail-closed conditions: the viewer's roles must pass the access rule of the read model's `<source>:detail` query, and the entity must declare `access.read`, since its queries filter rows by hand and the gate can only reproduce `access.read`. A read model without `access.read` never makes a document visible. `ParentVisibilityOption` has the optional `readModelEntities` map (entity and projection table) for this; `resolveTable`, link and parentRef gates are unchanged.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: documents filed from a mail attachment are visible to whoever may read the mail
detail: The `inbound-message` read model now declares `access.read` for the member roles: shared mailboxes are readable by every member, a personal mailbox only by its owner, admins included. `createInboundMessageEntity(memberRoles)` builds the entity for the configured roles; `inboundMessageEntity` stays exported with the default roles. The message queries filter rows as before and do not use this rule.
-->
