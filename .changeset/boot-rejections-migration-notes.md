---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Migration notes for boot checks that were released as fixes

<!-- kumiko-changes
feature: framework
type: breaking
title: Boot checks from the review round 1 release reject configurations that used to boot
detail: |
  These checks shipped as fixes without migration notes. Each one throws for a configuration that was accepted before:
  - a where-rule subquery on a table whose columns cannot be derived
  - a drawer prefill that targets a sensitive field or a field the form does not render
  - two secret fields with the same id
  - access.personalData "public-intake" combined with rateLimit: { disabled: true }
  - a recordOwned field on an entity with idType "serial"
  - dedupeFeatures for same-named features with different registrations
  The agent-tools manifest check in buildToolCatalog throws when the catalog is built for a request, not at boot.
migration: |
  Boot every app against the new version before rolling it out, and send one agent tool request if the app mounts agent-tools. Give where-rule subqueries a table with derivable columns, prefill only rendered non-sensitive fields, make secret field ids unique, give public-intake handlers a rateLimit that is not disabled, switch recordOwned entities to idType "uuid" or change the field's personal stance, and rename or align duplicated features.
-->
