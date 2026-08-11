---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

`Form`'s new `stickyActions` prop pins the actions footer to the viewport bottom on narrow screens (`<640px`) instead of normal document flow, so a virtual keyboard shrinking the viewport can no longer push it out of reach. `RenderEdit` sets it automatically for wizard-mode screens. The default HTML shell's viewport meta also gains `interactive-widget=resizes-content`, so a real mobile keyboard shrinks the layout viewport (which the fixed footer anchors to) instead of only the visual viewport.
