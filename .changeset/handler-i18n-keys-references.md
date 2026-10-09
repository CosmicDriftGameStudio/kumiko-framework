---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-cli": minor
---

Handler titles and field labels as an i18n convention, plus the `references` Zod meta

- `handlerTitleKey(qn)` gives `<qn>:title`, `handlerFieldLabelKey(qn, field)` gives `<qn>:field:<field>`. Exported from `@cosmicdrift/kumiko-framework/engine` and `@cosmicdrift/kumiko-framework/ui-types`. The client resolves keys verbatim, so a feature writes the full keys in `r.translations`, e.g. `channel-texts:write:generate:title` and `channel-texts:write:generate:field:vehicleId`, best built with `handlerTitleKey(qn)`.
- A translation key that already starts with the kebab form of the feature name (`channel-texts:write:x:title` for `channelTexts`) is no longer prefixed a second time.
- `handlerFieldReference(schema, field)` and `HANDLER_FIELD_REFERENCES_META_KEY` (`@cosmicdrift/kumiko-framework/engine`) read `.meta({ references: "<entity>" })` on a handler input field, through optional, nullable and default wrappers. Boot fails when the value names no registered entity (`"<entity>"` or `"<feature>:<entity>"`). The value also appears in the agent tool JSON Schema.
- `findHandlerTranslationGaps(features)` (`@cosmicdrift/kumiko-bundled-features/agent-tools`) reports `handler-without-translation` for agent-exposed write handlers without an entity mapping or actionForm screen that lack title or field-label keys (system-only fields are skipped). `kumiko agent lint` prints these in a separate warning section that never changes the exit code; the boot prints a single summary line. `findAgentDocGaps` is deliberately unchanged, because the agent-manifest guard fails hard on every gap it returns.

<!-- kumiko-changes
feature: framework
type: improvement
title: Handler titles and field labels as i18n keys, plus the references Zod meta
detail: `handlerTitleKey(qn)` (`<qn>:title`) and `handlerFieldLabelKey(qn, field)` (`<qn>:field:<field>`) define where a handler's title and input labels live; a feature declares the full keys (e.g. `channel-texts:write:generate:title`, built with `handlerTitleKey(qn)`) in `r.translations`, because the client resolves keys without a feature prefix. Mark a handler input field that points at an entity with `vehicleId: z.string().meta({ references: "vehicle" })` (or `"feature:entity"`); boot throws when the entity is unknown and `handlerFieldReference(schema, field)` reads it. `findHandlerTranslationGaps` reports agent-exposed write handlers without an entity or actionForm screen and without these keys as `handler-without-translation`. `kumiko agent lint` lists them as warnings without affecting the exit code, and the boot prints one summary line. `findAgentDocGaps` stays unchanged on purpose, since the agent-manifest guard fails on every gap it returns.
-->
