// The en-catalogs used to be hand-kept, so a registered key missing from them never failed any test. Everything here is held to the harvested English copy.

import { beforeAll, describe, expect, test } from "bun:test";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { localeEsBundle } from "@cosmicdrift/kumiko-locale-es";
import { frameworkEnCatalog as germanEnCatalog } from "../../../../../packages/locale-de/src/__tests__/en-catalog";
import { frameworkEnCatalog as spanishEnCatalog } from "../../../../../packages/locale-es/src/__tests__/en-catalog";
import { type EnHarvest, harvestEnglish } from "./i18n-harvest";

type Bundle = Readonly<Record<string, string>>;

const SUPPORTED_LOCALES: readonly { readonly locale: string; readonly bundle: Bundle }[] = [
  { locale: "de", bundle: localeDeBundle },
  { locale: "es", bundle: localeEsBundle },
];

const CATALOGS: readonly { readonly locale: string; readonly catalog: Bundle }[] = [
  { locale: "de", catalog: germanEnCatalog },
  { locale: "es", catalog: spanishEnCatalog },
];

// Client plugins that ship no English copy of their own (their screens use server or renderer keys).
const CLIENTS_WITHOUT_OWN_COPY: ReadonlySet<string> = new Set([
  "client:cap-overview",
  "client:billing-foundation",
  "client:tenant",
  "client:delivery",
  "client:legal-pages",
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

  test("each locale's en-catalog equals the registered English copy", () => {
    const drift = CATALOGS.flatMap(({ locale, catalog }) => {
      const unregistered = Object.keys(catalog)
        .filter((key) => harvest.en[key] === undefined)
        .map((key) => `${locale}: ${key} -> not registered by any feature`);
      const uncatalogued = Object.keys(harvest.en)
        .filter((key) => catalog[key] === undefined)
        .map((key) => `${locale}: ${key} -> missing from en-catalog`);
      const changed = Object.keys(catalog)
        .filter((key) => harvest.en[key] !== undefined && harvest.en[key] !== catalog[key])
        .map((key) => `${locale}: ${key} -> en-catalog text differs from the registered text`);
      return [...unregistered, ...uncatalogued, ...changed];
    });
    expect(drift).toEqual([]);
  });
});
