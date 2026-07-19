# Styleguide

Visueller Katalog der Kumiko-UI-Fläche: Foundations (Farben, Radius,
Elevation, Spacing), atomare Primitives (Buttons, Cards, Inputs) und das
**Mid-Level-Widget-Kit** (StatCard, SectionCard, StatusBadge, Charts,
ModeSwitch, …). Zugleich die e2e-Renderfläche der Widgets — wer ein
Widget ändert, sieht hier sofort, ob es überall noch stimmt.

Zwei Widget-Seiten zeigen dieselben Bausteine auf beiden Wegen:

- **`/widgets`** — der Katalog als Custom-Screen: jedes Widget direkt
  komponiert (StatCard-Raster, Uptime-/Timeseries-Charts, Status-Tones,
  ModeSwitch + DetailList, CollapsibleSection + EmptyState).
- **`/widgets-dashboard`** — derselbe Inhalt **deklarativ** als
  `r.screen({ type: "dashboard" })` mit stat/chart/list-Panels aus
  Demo-Queries: kein JSX, Labels als i18n-Keys, Boot-Validator prüft
  die Key-Abdeckung.

## Run

```bash
bun kumiko dev                    # Postgres + Redis
cd samples/apps/styleguide && bun dev
# → http://localhost:4180
```

## Tests

```bash
cd samples/apps/styleguide && bunx --bun playwright test
```

`e2e/widgets.spec.ts` prüft beide Widget-Seiten (Rendern aller Sektionen,
ModeSwitch-Interaktion, Dashboard-Panels aus den Demo-Queries).
