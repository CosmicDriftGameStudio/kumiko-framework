---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-document-designer": patch
"@cosmicdrift/kumiko-renderer-mail-html": patch
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
---

The registrar takes one object per call: r.writeHandler, r.queryHandler, r.entity, r.requires and r.hook lose their positional forms

<!-- kumiko-changes
feature: framework
type: breaking
title: Registrar methods take a single object, positional calls throw at registration
detail: |
  r.writeHandler, r.queryHandler, r.entity, r.requires and r.hook now take one object. The positional overloads are gone from the types and throw when the feature is defined, with a message that points at the codemod. The throw is removed in the first release after 2026-10-29.

  writeHandler (queryHandler is the same shape):
    before: r.writeHandler("order:archive", schema, handler, { access });
    after:  r.writeHandler({ name: "order:archive", schema, handler, access });

  hook (type picks the handler shape, target is a name, a list or { allOf }):
    before: r.hook("postSave", "order", handler, { escapeHatch });
    after:  r.hook({ type: "postSave", target: "order", handler, escapeHatch });

  entity and requires:
    before: r.entity("order", definition, { table: ordersTable });  r.requires("auth", "tenant");
    after:  r.entity({ name: "order", ...definition, backingTable: ordersTable });  r.requires({ features: ["auth", "tenant"] });

  registerEntityCrud is no longer exported from @cosmicdrift/kumiko-framework/engine; call r.crud(name, entity, options) instead. The entity option { table } is now backingTable on the r.entity object and lands in the feature's entityTables, not in its entities. HookDefinition and EntityObjectDefinition are exported from @cosmicdrift/kumiko-types. Hook definitions are checked per type: validation takes no escapeHatch, phase only exists on postSave and postDelete, and { allOf } is not accepted on preSave.
migration: Run `bun kumiko-upgrade --apply`. It rewrites every positional r.writeHandler, r.queryHandler, r.entity, r.requires, r.hook and registerEntityCrud call to the object form. Calls it cannot resolve statically (a spread argument, a registrar that is not typed as FeatureRegistrar) are listed as manual work with file and line; rewrite those by hand.
codemod: scripts/codemod/object-form.ts
manualAfterCodemod: true
-->
