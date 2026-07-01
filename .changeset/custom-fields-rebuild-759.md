---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Custom-field values now survive a host-entity projection rebuild (#759).

- New registrar API `r.extendEntityProjection(entityName, { sources?, apply })`: merges extra apply handlers (+ extra event sources) into the entity's implicit projection so `rebuildProjection` replays event types that a bundled extension materializes into the host entity's table. Rebuild-only — the inline runner keeps skipping implicit projections, live delivery stays with the extension's MSP.
- `ProjectionDefinition.extraSources`: additional aggregate-types included in the rebuild event filter while `source` keeps meaning "the owning entity" (soft-delete-cleanup et al. unchanged).
- `wireCustomFieldsFor` registers its `customField.set`/`.cleared`/`fieldDefinition.deleted` applies through the new API. Previously a schema-migration rebuild reset every `customFields` jsonb to `{}` with no recovery path; the table-less custom-fields MSP was categorically excluded from `rebuildMultiStreamProjection`.
