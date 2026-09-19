---
"@cosmicdrift/kumiko-types": minor
---

EventMetadata: feature + handler + UNATTRIBUTED_ORIGIN

EventMetadata traegt zwei neue optionale Felder (feature, handler) und exportiert die Sentinel-Konstante UNATTRIBUTED_ORIGIN fuer Appends ausserhalb eines attribuierten Ausfuehrungsscopes. Additiv, bestehende Zeilen bleiben ohne Backfill lesbar.

<!-- kumiko-changes
feature: types
type: improvement
title: EventMetadata: feature + handler + UNATTRIBUTED_ORIGIN
-->
