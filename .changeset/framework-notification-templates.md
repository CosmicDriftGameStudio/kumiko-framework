---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

r.notification declares variables, mail template text and meta

<!-- kumiko-changes
feature: framework
type: improvement
title: r.notification declares variables, template and meta; applyBootSeeds seeds them
detail: r.notification accepts variables (typed with templateVariable.text, link, money, date and list), template (per locale body, document html) and meta (per locale subject and more). Boot validation requires a kebab-case name, a meta.<locale>.subject for every template locale and valid placeholder names. templateVariablesToZod turns the variables into a Zod schema. applyBootSeeds calls seedNotificationTemplates, which writes the text as system templates of kind mail and fails loudly when notifications declare a template but the template-resolver feature is not mounted.
-->
