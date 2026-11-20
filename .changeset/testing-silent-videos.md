---
"@cosmicdrift/kumiko-testing": patch
---

`defineVideo` accepts a video without `voice`: it renders silent, with no texts, no TTS call, no audio track and a `<locale>.jpg` poster next to the MP4.

<!-- kumiko-changes
feature: testing
type: improvement
title: Silent videos in the video generator
detail: `voice` is now optional on `defineVideo`. A video without it needs no `text.<locale>.yaml` and no `OPENROUTER_API_KEY`, lasts exactly as long as its scene actions, gets no 500 ms lead-in, no subtitles file and no AI-voice notice, is muxed with `-an`, and writes a first-frame poster `out/<locale>.jpg`. `music` without `voice` is rejected. Voiced videos are unchanged.
-->
