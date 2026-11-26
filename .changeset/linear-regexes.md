---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-document-designer": patch
"@cosmicdrift/kumiko-feature-ast": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-cli": patch
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-guards": patch
---

Log redaction, the custom CSS filter, string trims and text parsing no longer slow down quadratically on long runs of the same characters; results are unchanged.

<!-- kumiko-changes
feature: framework
type: fix
title: Log redaction, CSS filter and string trims scan long inputs once
detail: URL and email redaction in logs, the custom CSS function check, trailing slash, dash, equals and newline trims, and several parsers in the CLI, dev server and guards rescanned long runs of the same characters once per character. They now scan each run once. Output is unchanged.
-->
