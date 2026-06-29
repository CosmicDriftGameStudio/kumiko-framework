---
"@cosmicdrift/kumiko-headless": minor
---

Apex header nav now supports dropdown menus. A nav entry can be a plain link **or**
`{ kind: "menu", label, items: [{ icon?, title, desc?, href }], footer? }` — the renderer
emits a CSS-only mega-menu (reveals on hover + keyboard focus; the panel is a light popover
in both themes). Plain links and menus mix freely in `header.navLinks`. The dropdown styling
ships in `APEX_STRUCTURAL_CSS` (and is exported standalone as `APEX_NAV_MENU_CSS`).
`renderApexHeader(header)` is now exported so a consumer composing its own page shell can
reuse the identical header chrome.
