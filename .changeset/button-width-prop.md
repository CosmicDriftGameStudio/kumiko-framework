---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

`Button`: `fullWidth?: boolean` → `width?: "full" | "auto"` (default `"auto"`). Bounded Value-Prop statt Boolean-Flag — `width="full"` streckt CTA-Buttons auf Container-Breite, andere Breiten bleiben Layout-Sache des Containers. Ersetzt das erst in 0.140 eingeführte `fullWidth` (noch kein externer Consumer).
