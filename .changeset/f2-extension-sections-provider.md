---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

`ExtensionSectionsProvider` + `useExtensionSectionComponent(name)`-Hook für client-side Component-Auflösung im entityEdit-Screen via `__component`-Marker. Apps registrieren Components über das neue `ClientFeatureDefinition.extensionSectionComponents`-Feld (Pattern analog zu `columnRenderers`, Last-Wins-Semantik bei Multi-Feature-Kollision). `createKumikoApp` aggregiert + mountet den Provider automatisch. RenderEdit mountet die aufgelöste Component mit `{ entityName, entityId }`; fehlt die Registrierung → Banner mit dem gesuchten Component-Namen.
