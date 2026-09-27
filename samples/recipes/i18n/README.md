# i18n

Feature-scoped translations — 'Hallo' and 'Hello' in the same app.

## What it shows

- `r.translations()` for multi-language feature keys
- Plurals

## Plurals

A translation value can be a CLDR plural-forms object instead of a plain
string. `other` is required; the rest (`zero`/`one`/`two`/`few`/`many`) only
exist where the locale's grammar needs them:

```ts
"greeting.unread_count": {
  de: { one: "{count} ungelesene Nachricht", other: "{count} ungelesene Nachrichten" },
  en: { one: "{count} unread message", other: "{count} unread messages" },
},
```

`t(key, locale, { count })` picks the CLDR category for `count` via
`Intl.PluralRules(locale)`, then interpolates `{count}` (and any other
`{name}` placeholder) into the chosen form.

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/i18n
bun test
```
