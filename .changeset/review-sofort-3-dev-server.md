---
"@cosmicdrift/kumiko-dev-server": patch
---

Server bundle finds worker.js and bootstrap.js next to a bin/main.js, and the dev PII restore keeps an app-supplied blind-index key

<!-- kumiko-changes
feature: dev-server
type: fix
title: buildServerBundle resolves worker and bootstrap entries as .ts or .js; runDevApp stop keeps an explicit blindIndexKey
detail: An app with bin/main.js and bin/worker.js used to get no dist-server/worker.js without any warning, because only worker.ts and bootstrap.ts were looked up. Siblings now resolve like the server entry, .ts first and then .js. In the ephemeral PII default, stopping runDevApp unset a blindIndexKey that the app passed itself; it now unsets only the key the default generated.
-->
