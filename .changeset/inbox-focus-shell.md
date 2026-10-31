---
"@cosmicdrift/kumiko-renderer": minor
---

Focused shell mode with an icon rail, plain tabs with counts, step sources, and an icon button inside text inputs.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Focused shell mode and inbox reader building blocks
detail: useShellFocusMode() collapses DefaultAppShell and WorkspaceShell to a 56px icon rail and hides the header toggle, bell and header actions while a screen is mounted. Tabs take icon, detail and appearance "plain" (muted counts). StepList rows take sources and highlighted. The text Input primitive and AiTextField/AiTextArea take endAction, an icon button inside the right edge (e.g. a microphone). StepList takes status (badge) and subtitle for the header. PdfPreview variant "viewer" takes matchIndex, onMatchesChange and hideSearchBar so a host can drive hit navigation from its own stepper. MobileTopBar is the phone-only (md:hidden) top bar for focused screens, with label, optional back chevron, status chip and actions, since the shell header is hidden there. StepList takes fill (full container height, footer pinned) and shows done steps with the ok token. progress "count" keeps only the "x of y done" count, "none" hides count and bar. MessageThread html bodies show a quiet "HTML mail, shown sanitized. External images blocked." line with a link-style "Load images" action, hide blocked images instead of a broken frame, and render sanitized tables without outer borders and with thin row dividers. A rejected StepList step uses a neutral grey disc with the secondary text tone for its X icon. PdfViewer search marks only the matched characters in amber (stronger for the active match) and matches phrases across text-layer lines, ignoring whitespace. The focus rail uses 40px rounded-md tiles with muted sidebar icons, 4px spacing and a 32px rounded-md brand tile. PdfPreview/PdfViewer take fill (no 480px floor, the host layout sizes the pane). MessageThread takes showHeaders false to drop author, address and time above open messages.
-->
