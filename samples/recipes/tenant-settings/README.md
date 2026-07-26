# Recipe: Tenant-Settings

**What this shows:** how a per-tenant Currency + Locale default fills a
money/locale field on create — without hard-coding `"EUR"`/`"de"` as a field
literal, the mistake that cost a sibling project (phronexsis) a retrofit once
a second tenant needed a different default.

## Pattern

```ts illustration
import {
  createEntity,
  createMoneyField,
  createSelectField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { defineCreateWithTenantDefaults } from "@cosmicdrift/kumiko-bundled-features/tenant-settings";

export const invoiceEntity = createEntity({
  table: "read_invoices",
  fields: {
    title: createTextField({ required: true }),
    amount: createMoneyField({ required: true }),
    language: createSelectField({ options: ["en", "de", "fr"] as const }),
  },
});

export const invoiceFeature = defineFeature("invoice", (r) => {
  r.entity("invoice", invoiceEntity);
  r.writeHandler(
    defineCreateWithTenantDefaults("invoice", invoiceEntity, {
      access: { roles: ["Admin"] },
      currencyFields: ["amount"],
      localeField: "language",
    }),
  );
  // update/delete/list/detail stay the plain defineEntity*Handler factories —
  // only create needs the tenant-default fill-in.
});
```

Mount `createTenantSettingsFeature()` alongside — it provisions the two
config keys (`tenant-settings:config:currency`, `tenant-settings:config:locale`)
that `defineCreateWithTenantDefaults` reads:

```ts illustration
import { createTenantSettingsFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-settings";

const features = [createConfigFeature(), createTenantSettingsFeature(), invoiceFeature];
```

`createTenantSettingsFeature(opts)` takes `currencies`, `defaultCurrency`,
`defaultLocale`, `write` — an app with its own supported-currency list or
role vocabulary overrides those instead of forking the feature.

## Why the schema needs a special case

`buildInsertSchema` always makes `currency` required *inside* a money field's
value object, even when the field itself is optional — a caller literally
cannot submit `{ amount: 1000 }` against the plain `defineEntityCreateHandler`.
`defineCreateWithTenantDefaults` swaps in its own schema (`.extend()` over the
same `buildInsertSchema` output, with just the declared `currencyFields`
relaxed) so the caller *can* omit `currency`, then fills it from
`ctx.config(TenantSettingsConfig.currency)` before delegating to the same
`executor.create()` the generic factory uses.

## Settings-Hub

Both keys declare `mask`, so they surface in the self-populating Settings-Hub
(Tenant-Audience) without a hand-written `r.screen`/`r.nav` — same mechanism
as [managed-config](/en/samples/recipes-managed-config/). A `TenantAdmin`
changes them from **Settings → Tenant → Default Currency / Default Locale**.

## Flow

1. No tenant override yet → a new invoice gets the *feature's own* default
   (`"EUR"`/`"en"`, set via `createTenantSettingsFeature()`'s own defaults).
2. Tenant sets `currency` to `"CHF"` and `locale` to `"de"` via the
   Settings-Hub (or `config:write:set` directly).
3. A new invoice that doesn't specify `amount.currency`/`language` picks up
   `"CHF"`/`"de"` — no entity code changed, no second migration.
4. A caller that *does* specify `amount.currency` still wins — the tenant
   setting only fills gaps, it never overrides an explicit value.

## Tests

```bash
bun test src/__tests__/feature.integration.test.ts
```

Proves all four steps above, plus that the feature boots without a
`tenant-settings` mount (falls back to the field literal — `defineCreateWithTenantDefaults`'s
`ctx.config?.(...)` call is optional-chained).

## What's not in this recipe

- **Timezone, number-format, week-start** — deliberately out of scope; add
  them as further config keys on the same feature when a real consumer needs
  them, don't speculate ahead of a use case.
- **A dedicated locale-options select** — `locale` is a free-text ISO-639-1(-region)
  field validated by regex, not a fixed enum, because the framework doesn't
  own which languages an app supports. An app with a fixed language list
  builds its own `createTenantConfig("select", {...})` key if it wants a
  dropdown instead of `TenantSettingsConfig.locale`.

## Related samples

- [managed-config](/en/samples/recipes-managed-config/) — the `mask` +
  Settings-Hub mechanism these keys rely on, explained in depth.
