---
"@cosmicdrift/kumiko-renderer": minor
---

Focused shell mode with an icon rail, plain tabs with counts, step sources, and an icon button inside text inputs.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Focused shell mode and inbox reader building blocks
detail: useShellFocusMode() collapses DefaultAppShell and WorkspaceShell to a 56px icon rail and hides the header toggle, bell and header actions while a screen is mounted. Tabs take icon, detail and appearance "plain" (muted counts). StepList rows take sources and highlighted. The text Input primitive and AiTextField/AiTextArea take endAction, an icon button inside the right edge (e.g. a microphone). StepList takes status (badge) and subtitle for the header. PdfPreview variant "viewer" takes matchIndex, onMatchesChange and hideSearchBar so a host can drive hit navigation from its own stepper.
-->
