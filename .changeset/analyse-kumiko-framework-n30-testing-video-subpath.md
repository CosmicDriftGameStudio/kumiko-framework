---
"@cosmicdrift/kumiko-testing": minor
---

The video tooling moves from `@cosmicdrift/kumiko-testing/e2e` to `@cosmicdrift/kumiko-testing/video`.

<!-- kumiko-changes
feature: testing
type: breaking
title: Video tooling on its own subpath
detail: `defineVideo`, `runVideos`, `editorStage`, `terminalStage`, `findVideoTextGaps`, `loadVideoTexts`, `DEFAULT_TTS_MODEL` and their types (`VideoDefinition`, `VideoScene`, `VideoSceneContext`, `VideoTools`, `VideoVoice`, `EditorLine`, `EditorStageOptions`, `PreviewBox`, `PreviewStage`, `StagePreview`, `StagePreviewCard`, `RunVideosOptions`, `StageOutputLine`, `StageTone`, `TerminalCommand`, `TerminalStageOptions`, `TypedStage`) are exported from `@cosmicdrift/kumiko-testing/video` and no longer from `./e2e`, so e2e specs do not load the video pipeline.
migration: Import the video API from `@cosmicdrift/kumiko-testing/video`.
affects: defineVideo, runVideos, editorStage, terminalStage, findVideoTextGaps, loadVideoTexts, DEFAULT_TTS_MODEL, VideoDefinition, VideoScene, VideoTools, VideoVoice, EditorLine, EditorStageOptions, PreviewBox, PreviewStage, StagePreview, RunVideosOptions, StageOutputLine, StageTone, TerminalCommand, TerminalStageOptions, TypedStage
-->
