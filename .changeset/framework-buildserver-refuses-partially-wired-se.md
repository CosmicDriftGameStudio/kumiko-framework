---
"@cosmicdrift/kumiko-framework": minor
---

buildServer refuses partially wired session callbacks

<!-- kumiko-changes
feature: framework
type: breaking
title: buildServer refuses partially wired session callbacks
migration: |
  If you call buildServer with auth.sessionCreator or auth.sessionRevoker, also wire the other two of sessionCreator, sessionRevoker and sessionChecker (the sessions feature's sessionStore provides all three; runProdApp and runDevApp already do this). Without a sessionChecker a logout never invalidated the JWT. A sessionChecker alone stays allowed.
-->
