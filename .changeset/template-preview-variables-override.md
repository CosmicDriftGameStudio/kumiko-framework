---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-document-designer": minor
---

Template preview and test mail can render with chosen values

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Preview and test mail render with the values of a picked record
detail: `template-resolver:query:preview` and `template-resolver:write:send-test` accept an optional `variables` object that replaces the declared example values for the named variables. The values are checked against the template's variable schema like a real send (unknown names and wrong types are rejected as `variables.<name>` validation errors); variables not passed keep their example. The mail editor now passes the values picked through the preview record picker into the preview and the test mail instead of only listing them.
-->
