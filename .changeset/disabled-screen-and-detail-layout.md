---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

Unavailable-screen empty state, projectionDetail title, folder picker

<!-- kumiko-changes
feature: renderer
type: fix
title: A route to a screen missing from the schema shows an empty state
detail: A tenant-disabled feature, stale link or typo no longer falls back to the first feature or shows "Screen not found: <qn>". The app renders "This page is not available" with a button to the landing screen; the qualified name only goes to the console. New i18n keys kumiko.screen-missing.title, .hint and .home (en, de, es). The access-denied banner of KumikoScreen and the toolbar drawer is now translated too (kumiko.screen-access-denied.title) and no longer prints the qualified name.
migration: e2e checks on the text "Screen not found" should use the testId kumiko-screen-not-found; the testIds are unchanged.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: projectionDetail drops the duplicate title block
detail: A screen with recordTitleField no longer repeats the screen title above the form when the page header already shows the record title.
-->

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: FileUploadInput folder mode
detail: FileUploadInput takes directory (sets webkitdirectory and multiple) and onFilesPicked. In directory mode it uploads nothing and hands the picked File[] with webkitRelativePath to the callback. Web-only: the input is not part of the cross-platform primitive contract.
-->
