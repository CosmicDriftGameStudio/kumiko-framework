---
"@cosmicdrift/kumiko-dev-server": patch
---

Dev-Server liefert das Default-HTML jetzt mit `<script type="module">`.

Als classic script werden die Top-Level-Deklarationen des Bundles zu
window-Properties. Eine Dependency mit `export function history()`
(prosemirror-history, kommt mit tiptap) ersetzt damit `window.history` —
danach wirft jedes `pushState`, und die Navigation ist tot, ohne dass die App
irgendetwas falsch gemacht hätte. Der Prod-Build emittiert die Modul-Form
seit jeher; nur der Dev-Server hing hinterher.
