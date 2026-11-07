---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-cli": patch
---

The assistant can read the app's handbook: `kumiko handbuch knowledge` exports the pages as JSON and the new `handbook-knowledge` feature serves them as two query tools. A task page can name the write handler that starts its flow (`start` in the frontmatter), so the assistant offers to start it as a plan.

<!-- kumiko-changes
feature: handbook-knowledge
type: improvement
title: Handbook pages for the AI assistant, with a process axis in the handbuch CLI
detail: `createHandbookKnowledgeFeature({ pages, access })` mounts the query handlers `list-pages` (catalog of id, kind, title and questions) and `read-page` (one page in the caller's language, falling back to the default language, cut at 12000 characters with a notice; with `publicPath` it links the page as `<publicPath>/<id>`). Both appear in the agent tool catalog for the roles in `access`; no entity, no migration. The handbuch config takes an optional `processTextsDir` (with `{locale}`): its pages show as an own group in the HTML, and the new command `kumiko handbuch knowledge <config> --out <file>` writes the pages per locale as deterministic JSON without images. A process page may carry `start` (qualified name of a write handler); `list-pages` and `read-page` return it, and their descriptions tell the assistant to answer with the page's steps, link the page and offer to start the task as a plan through exactly that handler. Without `processTextsDir` the built handbook stays byte-identical.
-->
