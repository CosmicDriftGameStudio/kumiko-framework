---
"@cosmicdrift/kumiko-headless": minor
---

`renderApexHeader()` consumers that compose their own page shell instead of `renderApexPage` (money-horse, show-pony, the docs sample) previously had no way to get a working mobile nav-toggle: `APEX_NAV_MENU_CSS` alone hides the hamburger unconditionally, and the rules that show it and open the dropdown under 640px lived only inside `RESPONSIVE`, which those consumers never imported — the toggle rendered but stayed invisible on mobile, so `navLinks` (including any language switcher) were unreachable there.

`APEX_NAV_TOGGLE_RESPONSIVE_CSS` is a new standalone export with just those mobile-toggle rules. Include it alongside `APEX_NAV_MENU_CSS` to get a working toggle without pulling in `RESPONSIVE`'s page-level grid breakpoints. Its two "show" rules use a `.nav ` prefix (matching `renderApexHeader`'s own markup) so they outrank `APEX_NAV_MENU_CSS`'s "display: none" default on specificity, regardless of which order a consumer concatenates the two blocks in. It also declares `.nav { position: relative; }`, the positioned ancestor the open dropdown anchors to — none of the three affected consumers' own header CSS sets that, so without it the dropdown would open off-screen even once the hamburger itself became visible.

`APEX_STRUCTURAL_CSS` (used by `renderApexPage`) is unaffected — same rules, same effective output, no visual change.
