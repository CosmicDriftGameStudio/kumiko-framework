// The en-catalogs used to be hand-kept, so a registered key missing from them never failed any test. Everything here is held to the harvested English copy.

import { beforeAll, describe, expect, test } from "bun:test";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { localeEsBundle } from "@cosmicdrift/kumiko-locale-es";
import { localeFrBundle } from "@cosmicdrift/kumiko-locale-fr";
import { localeItBundle } from "@cosmicdrift/kumiko-locale-it";
import { frameworkEnCatalog } from "../../../../../packages/locale-de/src/__tests__/en-catalog";
import { type EnHarvest, harvestEnglish } from "./i18n-harvest";

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
}

type Bundle = Readonly<Record<string, string>>;

const SUPPORTED_LOCALES: readonly { readonly locale: string; readonly bundle: Bundle }[] = [
  { locale: "de", bundle: localeDeBundle },
  { locale: "es", bundle: localeEsBundle },
  { locale: "fr", bundle: localeFrBundle },
  { locale: "it", bundle: localeItBundle },
];

// Client plugins that ship no English copy of their own (their screens use server or renderer keys).
const CLIENTS_WITHOUT_OWN_COPY: ReadonlySet<string> = new Set([
  "client:cap-overview",
  "client:billing-foundation",
  "client:tenant",
  "client:delivery",
  "client:legal-pages",
  "client:inbound-mail-foundation",
]);

let harvest: EnHarvest;

beforeAll(async () => {
  harvest = await harvestEnglish();
});

describe("i18n parity", () => {
  // A moved feature folder or catalog would otherwise drop out of the harvest silently.
  test("every harvest source family contributes entries", () => {
    const origins = Object.entries(harvest.entryCountByOrigin);
    const countFor = (prefix: string) =>
      origins.filter(([origin]) => origin.startsWith(prefix)).reduce((sum, [, n]) => sum + n, 0);
    expect(countFor("server:")).toBeGreaterThan(0);
    expect(countFor("client:")).toBeGreaterThan(0);
    expect(harvest.entryCountByOrigin["renderer"]).toBeGreaterThan(0);
    expect(harvest.entryCountByOrigin["mail:auth"]).toBeGreaterThan(0);
    expect(harvest.entryCountByOrigin["mail:gdpr"]).toBeGreaterThan(0);
  });

  test("every client and mail source yields entries", () => {
    const empty = Object.entries(harvest.entryCountByOrigin)
      .filter(
        ([origin, count]) =>
          /^(client|mail):/.test(origin) && count === 0 && !CLIENTS_WITHOUT_OWN_COPY.has(origin),
      )
      .map(([origin]) => origin);
    expect(empty).toEqual([]);
    expect(Object.keys(harvest.entryCountByOrigin).some((o) => o.startsWith("client:"))).toBe(true);
  });

  test("no key carries different English copy in different sources", () => {
    expect(harvest.conflicts).toEqual([]);
  });

  test("every registered English key has a value in every supported locale", () => {
    const missing = SUPPORTED_LOCALES.flatMap(({ locale, bundle }) =>
      Object.keys(harvest.en)
        .filter((key) => bundle[key] === undefined)
        .map((key) => `${key} -> ${locale}`),
    );
    expect(missing).toEqual([]);
  });

  test("the en-catalog equals the registered English copy", () => {
    const unregistered = Object.keys(frameworkEnCatalog)
      .filter((key) => harvest.en[key] === undefined)
      .map((key) => `${key} -> not registered by any feature`);
    const uncatalogued = Object.keys(harvest.en)
      .filter((key) => frameworkEnCatalog[key] === undefined)
      .map((key) => `${key} -> missing from en-catalog`);
    const changed = Object.keys(frameworkEnCatalog)
      .filter((key) => harvest.en[key] !== undefined && harvest.en[key] !== frameworkEnCatalog[key])
      .map((key) => `${key} -> en-catalog text differs from the registered text`);
    const drift = [...unregistered, ...uncatalogued, ...changed];
    expect(drift).toEqual([]);
  });

  test("no locale bundle carries keys outside the en-catalog", () => {
    const extra = SUPPORTED_LOCALES.flatMap(({ locale, bundle }) =>
      Object.keys(bundle)
        .filter((key) => frameworkEnCatalog[key] === undefined)
        .map((key) => `${key} -> ${locale}`),
    );
    expect(extra).toEqual([]);
  });

  test("interpolation placeholders match English in every locale", () => {
    const mismatched = SUPPORTED_LOCALES.flatMap(({ locale, bundle }) =>
      Object.keys(frameworkEnCatalog)
        .filter(
          (key) =>
            placeholders(bundle[key] ?? "").join() !==
            placeholders(frameworkEnCatalog[key] ?? "").join(),
        )
        .map((key) => `${key} -> ${locale}`),
    );
    expect(mismatched).toEqual([]);
  });

  test("locales use localized tenant wording, not raw English tenant labels", () => {
    const roleAllowlist = new Set(["TenantAdmin", "SystemAdmin"]);
    const offenders = SUPPORTED_LOCALES.flatMap(({ locale, bundle }) =>
      Object.entries(bundle)
        .filter(([, value]) => !roleAllowlist.has(value) && /\btenants?\b/i.test(value))
        .map(([key]) => `${key} -> ${locale}`),
    );
    expect(offenders).toEqual([]);
  });
});
