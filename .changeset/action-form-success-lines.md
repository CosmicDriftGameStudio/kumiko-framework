---
"@cosmicdrift/kumiko-renderer": patch
---

actionForm success box shows the message and every fact on its own line

<!-- kumiko-changes
feature: renderer
type: fix
title: actionForm success box shows the message and every fact on its own line
detail: The success message and the successFacts of an actionForm no longer run together ("Fertig.Gebucht: 20Übersprungen: 0"). The message is its own line, a fact with one value is one "Label: value" line, a fact with several lines (for example file names) is a label line followed by one line per value instead of a comma chain. New test ids action-form-success-text and action-form-success-fact-<n>-line-<i>.
migration: None. Tests that read the textContent of a multi-line fact now see the label and the lines without the former ", " separators.
-->
