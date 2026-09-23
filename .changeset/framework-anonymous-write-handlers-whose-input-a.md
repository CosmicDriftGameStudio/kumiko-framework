---
"@cosmicdrift/kumiko-framework": minor
---

Anonymous write handlers whose input accepts a personal-data field must declare access.personalData: "public-intake" (fw#2885)

RoleAccessRule ({ roles, personalData? }) gains an optional personalData?: RoleAccessPersonalData (currently only "public-intake"), exported from @cosmicdrift/kumiko-framework/engine and /ui-types alongside OpenToAllPersonalData. validateAccessDeclarations now requires personalData: "public-intake" on a write handler whose access.roles includes "anonymous" and whose input schema accepts a personal-data field (pii / userOwned / recordOwned) of an entity in the same feature; declaring personalData on the roles form of a query or stream handler is rejected, "public-intake" on roles without "anonymous" is rejected, and "tenant-members" on the roles form is rejected (openToAll keeps accepting only "tenant-members"). Unlike the existing openToAll owner-binding exemption, an anonymous handler is never exempted by an owner-bound access.write map: every anonymous caller shares one user.id ("anonymous"), so from("user:id", ...) binds no one specific. The feature-AST extractor (readOptionalAccessRule) reads roles.personalData the same way it already reads openToAll.personalData.

<!-- kumiko-changes
feature: framework
type: breaking
title: Anonymous write handlers whose input accepts a personal-data field must declare access.personalData: "public-intake" (fw#2885)
migration: |
  A write handler with "anonymous" in access.roles whose input schema accepts a personal-data field of an entity in the same feature now fails boot until it declares access: { roles: [..., "anonymous"], personalData: "public-intake" }. Owner-binding via from("user:id", "<column>") on the entity access.write does not exempt an anonymous handler (it does exempt an openToAll handler) — anonymous requests share a single caller identity, so rely on the handler's required rateLimit (per ip) instead. personalData: "public-intake" is only valid on the roles form and only with "anonymous" in roles; openToAll keeps accepting only personalData: "tenant-members". The check only sees entities of the handler's own feature; anonymous intake into another feature's entity is covered by the follow-up runtime gate (kumiko-framework#3165). No known bundled-feature handler is affected.
-->
