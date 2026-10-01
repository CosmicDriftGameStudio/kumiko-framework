---
"@cosmicdrift/kumiko-guards": patch
---

The html-escape guard now checks nested templates and local helpers that return input unescaped.

<!-- kumiko-changes
feature: guards
type: improvement
title: html-escape guard flags unescaped intermediate templates and raw-returning local helpers
migration: |
  Neue Violations bei ungeescapten Zwischen-Templates und lokalen Helfern, die Input roh zurueckgeben; diese per escapeHtml absichern.
-->
