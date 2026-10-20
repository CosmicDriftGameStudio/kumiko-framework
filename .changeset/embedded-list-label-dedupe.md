---
"@cosmicdrift/kumiko-renderer": patch
---

An embedded list does not repeat its section title as a visible label

<!-- kumiko-changes
feature: renderer
type: fix
title: An embedded list does not repeat its section title as a visible label
detail: When the label of an embedded-list field equals the title of the section it sits in (for example "Positionen" under "Positionen"), entityEdit and actionForm screens now keep the label for screen readers only instead of printing it twice. Applies by default, no setting.
migration: None.
-->
