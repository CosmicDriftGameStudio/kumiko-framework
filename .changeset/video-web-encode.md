---
"@cosmicdrift/kumiko-testing": patch
---

`runVideos` encodes MP4s for the web: CRF 28 with preset `slow` roughly halves animated trailers, and `+faststart` lets a browser start playback before the download finishes.

<!-- kumiko-changes
feature: testing
type: improvement
title: Smaller web-ready video files
detail: The video muxer encodes with CRF 28, preset slow and +faststart, so trailers shrink by about half and start playing while they load.
-->
