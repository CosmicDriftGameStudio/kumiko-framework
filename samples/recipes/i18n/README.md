# i18n

Feature-scoped translations — 'Hallo' and 'Hello' in the same app.

## What it shows

- `r.translations()` for multi-language feature keys
- Plurals
- `requiredLocales`: boot fails when a key misses one of the app's languages

## Plurals

A translation value can be a CLDR plural-forms object instead of a plain
string. `other` is required; the rest (`zero`/`one`/`two`/`few`/`many`) only
exist where the locale's grammar needs them:

```ts illustration
"greeting.unread_count": {
  de: { one: "{count} ungelesene Nachricht", other: "{count} ungelesene Nachrichten" },
  en: { one: "{count} unread message", other: "{count} unread messages" },
},
```

`t(key, locale, { count })` picks the CLDR category for `count` via
`Intl.PluralRules(locale)`, then interpolates `{count}` (and any other
`{name}` placeholder) into the chosen form.

## Required locales

Without further options boot only checks that each feature is consistent with
itself. An app that ships fixed languages lists them, and boot then fails on any
key that misses one of them, including framework keys. Locale packages such as
`locale-de` count:

```ts illustration
runProdApp({ ...options, validateBootOptions: { requiredLocales: ["de", "en"] } });
```

Define the options once and re-export them as `VALIDATE_BOOT_OPTIONS` from
`kumiko/schema.ts`, so `kumiko-schema validate` checks the same list in CI.

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/i18n
bun test
```
