---
status: reference
verified: 2026-07-11
evidence: "kumiko-platform#353 (App-Mounting 2.0); Scaffold: kumiko add feature (dev-server)"
---

# App-Feature-Struktur: die kanonische Ordner-Konvention

App-lokale Features folgen derselben Struktur wie bundled-features (Referenz:
`packages/bundled-features/src/tenant/`). `kumiko add feature <name>` scaffoldet
sie; `guard-app-feature-structure` (infra, `kumiko-guard-ui`) erzwingt sie in
den App-Repos.

```
src/features/<name>/
  feature.ts       # NUR Registrierung (r.entity / r.screen / r.job / …) — kein
                   # Logik-Dump (Guard: max 300 Zeilen)
  index.ts         # Server-Exports (Feature + Public-Types)
  constants.ts     # Feature-Name, Handler-Namen, Enums — keine Magic Strings
  i18n.ts          # Server-Translation-Keys (Screen-Titel, Field-Labels)
  handlers/        # eine Datei pro Handler: <thema>.query.ts / <thema>.write.ts
                   # (defineQueryHandler / defineWriteHandler)
  schema/          # Entity- + Table-Definitionen, index.ts re-exportiert
  lib/             # reine Domain-Logik: pure Funktionen mit Test
                   # (ohne r.*-Abhängigkeit)
  web/             # Client-Seite: index.ts ("@runtime client",
                   # ClientFeatureDefinition), i18n.ts, EIN Screen pro Datei
                   # — nur Komponenten + Hooks, keine Berechnung/Logik
  __tests__/       # mindestens der Boot-Test (validateBoot([feature]))
```

## Regeln

- **Screens deklarativ zuerst**: `entityList` (CRUD über die Entity),
  `projectionList` (query-getrieben: columns, rowActions inkl. writeHandler,
  Pager), `dashboard` (stat/chart/list-Panels). `type: "custom"` ist die
  Ausnahme und braucht einen Allowlist-Tag
  (`// kumiko-lint-ignore app-feature-structure <Grund>`).
- **Kein `web.tsx`/`web.ts`-Monolith am Feature-Root** — Client-Definition und
  Screens leben unter `web/`.
- **UI aus dem Framework**: Widgets (`StatCard`, `SectionCard`, `StatusBadge`,
  `QueryTable`, Charts, …) + `usePrimitives()` statt eigener Card/Table/Badge-
  Nachbauten (`guard-no-custom-primitives`), Theme-Tokens statt raw Tailwind-
  Farben (`guard-raw-classname`), kein Inline-CSS (`guard-no-inline-styles`).
- **Daten über den Hook-Satz**: `useQuery` (SSE via `live: true`),
  `useMutation`, `useDisclosure` — kein rohes `useEffect`/`fetch()` in Screens
  (`guard-no-raw-hooks`).
- **Text über i18n**: JSX-Text und Label-Props laufen über `t("…")`-Keys
  (`guard-i18n-ui-strings`); der Boot-Validator erzwingt die Key-Abdeckung.
- **Logik nach `lib/` (mit Test)**: Berechnung/Parsing/Aggregation gehört als
  pure Funktion nach `lib/` — `web/` enthält nur Komponenten + Hooks
  (`guard-no-logic-in-views`). Jede exportierte `lib/`-Funktion braucht einen
  Test, der aus dem Modul importiert und sie namentlich referenziert
  (`guard-lib-test-coverage`). Begründete Ausnahme:
  `// kumiko-lint-ignore no-logic-in-views <Grund>` bzw. `lib-test-coverage`.

## Warum

Die drei Consumer-Apps hatten vor der Konvention 1-File-Monolithen (feature.ts
mit ~500 Zeilen, web.tsx-Meta-Mapping, 850+ raw classNames, dreifach nachgebaute
Card/Chart-Primitives). Struktur + Guards machen den idiomatischen Weg zum
kürzesten — insbesondere für Coding-Agents, die sonst am Framework vorbei bauen.
