---
"@cosmicdrift/kumiko-dev-server": minor
---

init-deploy: `package.json#kumiko.deploy.dbName`

`migrate-step.sh` builds `DATABASE_URL` with `kumiko.deploy.dbName` as the database (default: appName), validated like `dbUser`. Apps without the key render byte-identical output.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: init-deploy reads kumiko.deploy.dbName for the migrate step's DATABASE_URL
-->
