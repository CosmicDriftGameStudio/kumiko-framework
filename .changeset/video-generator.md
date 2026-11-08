---
"@cosmicdrift/kumiko-testing": minor
---

`@cosmicdrift/kumiko-testing/e2e` gains a video generator: `defineVideo` describes scenes, `runVideos` records the real app with Playwright, narrates each scene with TTS from `text.<locale>.yaml` and builds an MP4 plus VTT. `findVideoTextGaps` lets an app test that every scene has text in every locale. `runVideos({ brandLogo })` overlays a brand logo (SVG or PNG) bottom right on every video, and `defineVideo({ music })` loops a music track under the narration, ducked while it speaks. `runVideos({ aiNotice })` adds a per-locale AI disclosure next to the logo and in the MP4 comment metadata.

<!-- kumiko-changes
feature: testing
type: improvement
title: Video generator for tutorial and marketing videos
detail: `defineVideo` and `runVideos` from `@cosmicdrift/kumiko-testing/e2e` record scenes from the real app or from an HTML stage with Playwright in virtual time, narrate them via Gemini TTS over OpenRouter (cached by text hash), and mux MP4 plus VTT with ffmpeg. Optional brand logo, background music with ducking and a per-locale AI disclosure.
-->
