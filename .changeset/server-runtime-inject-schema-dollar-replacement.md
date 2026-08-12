---
"@cosmicdrift/kumiko-server-runtime": patch
---

`injectSchema` no longer passes the injected schema JSON as the replacement-string argument to `String.prototype.replace()`. That argument interprets `$$`, `$&`, `` $` ``, and `$'` specially — a schema value containing one of those sequences (e.g. an i18n label with an apostrophe-prefixed pattern) could splice arbitrary parts of the surrounding HTML into the injected `<script>` tag, corrupting the page. Both insertion points (before `/client.js`, before `</body>`) now use a replacer function instead, which does not expand `$`-patterns.
