---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Bug-Bash 3 Wave L — Renderer- + Bundled-Features-Verbesserungen:

- **DataTable `rowActionMode="inline"`** (#8/#9): neues Prop, das Row-Actions
  immer als linksbündige Inline-Buttons rendert (auch bei >2 Actions, kein
  Kebab) — einheitliche, ausgerichtete Optik über alle Listen. Default bleibt
  `"adaptive"` (bisheriges Verhalten).
- **Config-Default-Wording** (#11): Cascade-Disclosure nutzt denselben Begriff
  „Standard"/„Default" wie das Feld-Label-Badge (statt „Vorgabe"/„Preset") —
  ein durchgängiger Begriff. Der Key `kumiko.config.cascade.preset` entfällt.
- **`slots.header`-Placement** (#12): der List-Header-Slot (z.B. Cap-Counter)
  rendert jetzt in der Listen-Toolbar statt als loser Text über dem Screen-Titel.
- **Composed Extension-Save** (#1): neuer `useExtensionFormSubmit`-Mechanismus —
  Extension-Sections (z.B. Custom-Fields) schreiben beim Haupt-Form-Submit mit,
  statt einen eigenen Save-Button zu führen. Der Haupt-Save aktiviert sich auch
  bei reiner Section-Änderung.
- **Profil-Seite** (#3): Sektionen als abgegrenzte Karten, Danger-Zone hervorgehoben.
