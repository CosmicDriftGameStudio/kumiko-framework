---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Field approval requires access.write on the field, refuses unsealed secret fields, checks the requester's entity write right and hides pending values from approvers who may not read the field.

<!-- kumiko-changes
feature: field-approval
type: breaking
title: Stricter field-approval rules
detail: Boot rejects access.approve without access.write (field-approval/needs-write) and on an encrypted or writeOnly field that is not encrypted under a data subject (field-approval/secret-field), because the pending value would be stored unsealed. request-change also checks the entity's access.write ownership against the host row (422 ownership_denied). pending-changes leaves out requests on fields the caller may not read, unless the caller filed them. userCanReadFieldRow is exported from @cosmicdrift/kumiko-framework/engine.
migration: Add access.write with every approve role to each approval-gated field. Move approve off encrypted or writeOnly fields, or annotate them with a personal subject.
affects: access.approve, createFieldApprovalFeature
-->
