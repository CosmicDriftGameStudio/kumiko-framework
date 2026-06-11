---
"@cosmicdrift/kumiko-framework": minor
---

Drei geteilte Bausteine aus den Review-Findings (studio#36/#46, studio#15, enterprise#95):

- **Pending-Rebuild-Queue** (`@cosmicdrift/kumiko-framework/migrations`):
  `queueRebuildsFromMarkers` + `runPendingRebuilds` persistieren
  Projection-Rebuilds in `kumiko_pending_rebuilds` — ein fehlgeschlagener
  Rebuild nach `schema apply` bleibt pending und wird beim nächsten Lauf
  nachgeholt, statt still verloren zu gehen.
- **`parseEnvDryRun`** (`@cosmicdrift/kumiko-framework/env`): ehrliches
  `Partial<z.infer<S>>` für den KUMIKO_DRY_RUN_ENV-Pfad statt
  `({} as Shape)`-Cast — vorhandene Werte typisiert gecoerct, wirft nie.
- **`buildManifestFromRegistry`** (`@cosmicdrift/kumiko-framework/engine`):
  die Feature-Manifest-Extraktion als geteilter Builder (+ `Manifest*`-Typen,
  `serializeManifest`, optionaler `tier`-Tag + Feature-Filter) — der
  use-all-bundled-Generator nutzt ihn bereits, der enterprise-Fork folgt.
