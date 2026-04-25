// E2E-Generator — leitet strukturierte TestSpecs aus der Registry ab.
//
// Grundidee: jede r.screen(...) ist eine testbare Oberfläche. Der Generator
// iteriert getAllScreens() und baut pro Screen einen Satz TestSpecs (vier
// Kinds, einer pro "was muss mindestens funktionieren"). Die Specs sind
// JSON-serialisierbar — Consumer (Sample/Package-e2e) schreiben sie via
// bun-Script als JSON auf Platte, und ein Playwright-globalSetup triggert
// das vor jedem Run. Der eigentliche Playwright-Runner liest die JSON und
// iteriert mit kind-spezifischen Handlern gegen den echten Renderer.
//
// Vorteil des 2-Prozess-Modells: die framework-runtime (Registry, drizzle,
// ioredis-types etc.) lädt NIE im Playwright-Worker. Würde sie das, kollidierte
// sie mit Playwrights Object.prototype-Symbolen ($$jest-matchers-object) und
// der Worker würde beim spec-import crashen.
//
// Zwei Stufen, jede einzeln testbar:
//   1. generateE2ESpec(registry)   — Registry → TestSpec[]
//   2. generateZodFixture(schema)  — ZodType  → plausibler Value
//
// Stufe 2 ist intentionally minimal (Strategy a aus dem Plan): string/number/
// boolean/date/enum/uuid + ZodOptional/ZodDefault-Unwrap. Alles andere wirft
// "not supported yet" — wir füllen nach, wenn ein echter Caller es braucht.
// Fake-komplexe-Werte würden nur False-Green-Tests produzieren.

import type { z } from "zod";
import {
  type EntityDefinition,
  type EntityEditScreenDefinition,
  type EntityListScreenDefinition,
  type FieldDefinition,
  normalizeEditField,
  normalizeListColumn,
  parseQn,
  qn,
  type Registry,
  toKebab,
} from "../engine";

// --- Spec-Shape ---

// Jeder TestSpec-Variant enthält alles was der Renderer zum Templaten braucht
// — keine Registry-Referenz, keine Lazy-Lookups. So sind Specs JSON-fähig
// (debug-dump, Snapshot-Vergleich) und der Renderer bleibt rein Template.
export type E2ETestSpec =
  | {
      readonly kind: "list-renders";
      readonly screenQn: string;
      readonly title: string;
      readonly urlPath: string;
    }
  | {
      readonly kind: "list-has-fixture-row";
      readonly screenQn: string;
      readonly title: string;
      readonly urlPath: string;
      readonly writeHandlerQn: string;
      readonly fixture: Readonly<Record<string, unknown>>;
      readonly identifyingValue: string;
    }
  | {
      readonly kind: "edit-validates-required";
      readonly screenQn: string;
      readonly title: string;
      readonly urlPath: string;
      readonly requiredFields: readonly string[];
    }
  | {
      readonly kind: "edit-save-persists";
      readonly screenQn: string;
      readonly title: string;
      readonly urlPath: string;
      readonly listUrlPath?: string;
      readonly fills: readonly EditFillOp[];
      readonly identifyingValue: string;
      readonly identifyingField: string;
    };

// Strukturierte Anweisung für den edit-save-persists-Renderer. Der Fixture
// allein sagt nicht, ob ein String in ein Text-Feld (`.fill`) oder in ein
// Dropdown (`.selectOption`) gehört — der Generator entscheidet anhand der
// FieldDefinition, der Renderer templated nur.
export type EditFillOp =
  | { readonly kind: "fill"; readonly field: string; readonly value: string }
  | { readonly kind: "check"; readonly field: string; readonly value: boolean }
  | { readonly kind: "select"; readonly field: string; readonly value: string };

export type E2EGeneratorOptions = {
  // Tenant-Slug/UUID als Template-Placeholder. Default "{tenant}" — der
  // Test-Runner ersetzt zur Laufzeit. Wer die URL fix tenant-scoped will,
  // setzt hier den Slug.
  readonly tenantPlaceholder?: string;
};

// --- Stufe 1: Spec-Ableitung aus der Registry ---

export function generateE2ESpec(
  registry: Registry,
  options: E2EGeneratorOptions = {},
): readonly E2ETestSpec[] {
  const tenant = options.tenantPlaceholder ?? "{tenant}";
  const specs: E2ETestSpec[] = [];

  for (const [screenQn, screen] of registry.getAllScreens()) {
    if (screen.type === "custom") continue; // keine generische Annahme möglich
    const { scope: feature, name: short } = parseQn(screenQn);
    const urlPath = `/t/${tenant}/${feature}/${short}`;
    const title = `${feature}/${short}`;

    if (screen.type === "entityList") {
      specs.push(...buildListSpecs(screen, screenQn, title, urlPath, registry));
    } else {
      specs.push(...buildEditSpecs(screen, screenQn, title, urlPath, registry, tenant));
    }
  }

  return specs;
}

function buildListSpecs(
  screen: EntityListScreenDefinition,
  screenQn: string,
  title: string,
  urlPath: string,
  registry: Registry,
): E2ETestSpec[] {
  const out: E2ETestSpec[] = [{ kind: "list-renders", screenQn, title, urlPath }];

  const entity = registry.getEntity(screen.entity);
  if (!entity) return out;

  const writeHandlerQn = findCreateHandlerQn(registry, screen.entity);
  if (!writeHandlerQn) return out;

  const fixture = buildEntityFixture(entity);
  const identifyingValue = pickIdentifyingValue(fixture, screen, entity);
  if (identifyingValue === undefined) return out;

  out.push({
    kind: "list-has-fixture-row",
    screenQn,
    title,
    urlPath,
    writeHandlerQn,
    fixture,
    identifyingValue,
  });

  return out;
}

function buildEditSpecs(
  screen: EntityEditScreenDefinition,
  screenQn: string,
  title: string,
  urlPath: string,
  registry: Registry,
  tenant: string,
): E2ETestSpec[] {
  const out: E2ETestSpec[] = [];
  const entity = registry.getEntity(screen.entity);
  if (!entity) return out;

  const requiredFields = collectRequiredEditFields(screen, entity);
  if (requiredFields.length > 0) {
    out.push({ kind: "edit-validates-required", screenQn, title, urlPath, requiredFields });
  }

  const fixture = buildEntityFixture(entity);
  const listScreen = findListScreenForEntity(registry, screen.entity);
  const listUrlPath = listScreen ? buildScreenUrlPath(listScreen.qn, tenant) : undefined;

  const identifying = pickIdentifyingForEdit(fixture, screen, entity, listScreen?.def);
  if (identifying) {
    const fills = buildEditFillOps(screen, entity, fixture);
    out.push({
      kind: "edit-save-persists",
      screenQn,
      title,
      urlPath,
      listUrlPath,
      fills,
      identifyingValue: identifying.value,
      identifyingField: identifying.field,
    });
  }

  return out;
}

function buildScreenUrlPath(qn: string, tenant: string): string {
  const { scope, name } = parseQn(qn);
  return `/t/${tenant}/${scope}/${name}`;
}

function findCreateHandlerQn(registry: Registry, entityName: string): string | undefined {
  // feature.writeHandlers ist mit Short-Names gekeyt ("task:create"), der
  // Registry-Lookup braucht die qualified Form ("tasks:write:task:create").
  // Wir qualifizieren via qn() + toKebab wie die Registry selbst — das ist
  // der Vertrag aus qualified-name.ts.
  for (const feature of registry.features.values()) {
    for (const shortName of Object.keys(feature.writeHandlers ?? {})) {
      if (!shortName.endsWith(":create")) continue;
      const qualified = qn(toKebab(feature.name), "write", toKebab(shortName));
      if (registry.getHandlerEntity(qualified) === entityName) return qualified;
    }
  }
  return undefined;
}

function findListScreenForEntity(
  registry: Registry,
  entityName: string,
): { qn: string; def: EntityListScreenDefinition } | undefined {
  for (const [qn, screen] of registry.getAllScreens()) {
    if (screen.type === "entityList" && screen.entity === entityName) {
      return { qn, def: screen };
    }
  }
  return undefined;
}

function collectRequiredEditFields(
  screen: EntityEditScreenDefinition,
  entity: EntityDefinition,
): string[] {
  const out: string[] = [];
  for (const section of screen.layout.sections) {
    for (const rawField of section.fields) {
      const { field } = normalizeEditField(rawField);
      const def = entity.fields[field];
      if (def && "required" in def && def.required === true) {
        out.push(field);
      }
    }
  }
  return out;
}

function pickIdentifyingValue(
  fixture: Readonly<Record<string, unknown>>,
  screen: EntityListScreenDefinition,
  entity: EntityDefinition,
): string | undefined {
  // Erste Text-Spalte mit Fixture-Wert — das ist die visuell zuverlässigste
  // Identifikation in einer generischen Tabelle.
  for (const raw of screen.columns) {
    const { field } = normalizeListColumn(raw);
    if (entity.fields[field]?.type !== "text") continue;
    const v = fixture[field];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function buildEditFillOps(
  screen: EntityEditScreenDefinition,
  entity: EntityDefinition,
  fixture: Readonly<Record<string, unknown>>,
): EditFillOp[] {
  // Laufe die Layout-Reihenfolge — das Resultat spiegelt, was ein User
  // tatsächlich ausfüllt. Per Field-Typ entscheiden wir die Interaktions-
  // form; Felder ohne Fixture-Wert (file/image/…) werden übersprungen.
  const ops: EditFillOp[] = [];
  for (const section of screen.layout.sections) {
    for (const raw of section.fields) {
      const { field } = normalizeEditField(raw);
      const def = entity.fields[field];
      if (!def) continue;
      const v = fixture[field];
      if (v === undefined) continue;

      switch (def.type) {
        case "boolean":
          if (typeof v === "boolean") ops.push({ kind: "check", field, value: v });
          break;
        case "select":
          if (typeof v === "string") ops.push({ kind: "select", field, value: v });
          break;
        case "text":
        case "number":
        case "date":
        case "timestamp":
        case "tz":
          ops.push({ kind: "fill", field, value: String(v) });
          break;
        // embedded/money/locatedTimestamp/file/image/files/images: keine
        // generische Interaktion — der Test-Autor liefert später einen
        // Hand-Override oder überspringt das Feld.
        default:
          break;
      }
    }
  }
  return ops;
}

function pickIdentifyingForEdit(
  fixture: Readonly<Record<string, unknown>>,
  editScreen: EntityEditScreenDefinition,
  entity: EntityDefinition,
  listScreen: EntityListScreenDefinition | undefined,
): { field: string; value: string } | undefined {
  // Bevorzugt ein Feld das im List-Screen als Column auftaucht — sonst ist
  // die "taucht in Liste auf"-Assertion nicht durchführbar.
  const columns = listScreen
    ? new Set(listScreen.columns.map((c) => normalizeListColumn(c).field))
    : undefined;

  for (const section of editScreen.layout.sections) {
    for (const rawField of section.fields) {
      const { field } = normalizeEditField(rawField);
      if (entity.fields[field]?.type !== "text") continue;
      if (columns && !columns.has(field)) continue;
      const v = fixture[field];
      if (typeof v === "string" && v.length > 0) return { field, value: v };
    }
  }
  return undefined;
}

// --- Stufe 2: Zod-Fixture (Strategy a) ---

// Zod 4 stabilisiert die Introspection auf `._def.type` (lowercase Discriminator)
// + `._def.format` für String-Formate (email/url/uuid/datetime) + `._def.entries`
// für Enums + `._def.innerType` für optional/default/nullable. Wir greifen
// gezielt auf diese Felder zu — genau die Form die unser buildInsertSchema
// emittiert. Andere Typen werfen "not supported yet", bis ein Sample den Fall
// konkret braucht.

type ZodInternals = {
  readonly type?: string;
  readonly format?: string;
  readonly innerType?: z.ZodTypeAny;
  readonly entries?: Record<string, string>;
};

function readZodInternals(schema: z.ZodTypeAny): ZodInternals | undefined {
  return (schema as unknown as { _def?: ZodInternals })._def;
}

export function generateZodFixture(schema: z.ZodTypeAny): unknown {
  const def = readZodInternals(schema);
  const typeName = def?.type;

  switch (typeName) {
    case "optional":
    case "nullable":
    case "default": {
      if (!def?.innerType) throw new Error(`zod ${typeName} without innerType`);
      return generateZodFixture(def.innerType);
    }
    case "string":
      return fixtureString(def?.format);
    case "number":
      return 1;
    case "boolean":
      return true;
    case "enum": {
      const first = def?.entries ? Object.values(def.entries)[0] : undefined;
      return first ?? "";
    }
    case "date":
      return new Date("2026-01-01T00:00:00Z");
    default:
      throw new Error(`generateZodFixture: not supported yet: ${typeName ?? "<unknown>"}`);
  }
}

function fixtureString(format: string | undefined): string {
  if (format === "email") return "e2e@example.com";
  if (format === "url") return "https://example.com";
  if (format === "uuid" || format === "guid") return "00000000-0000-4000-8000-000000000000";
  if (format === "datetime" || format === "date") return "2026-01-01T00:00:00Z";
  return "e2e-fixture";
}

// --- Fixture aus FieldDefinition (für Stufe 1 statt Zod-Schema) ---
//
// Bewusstes Duplicate zu generateZodFixture. Die beiden haben unterschiedliche
// Aufgaben:
//   generateZodFixture   — public, generisch, weiß nur Zod-Primitives
//   buildEntityFixture   — intern, Kumiko-Domain, weiß über file-skip,
//                          embedded-Shape, money/tz-Objekte und nutzt den
//                          Feldnamen für lesbare Prefixes ("e2e-email@...")
//
// Ein Zusammenziehen über buildInsertSchema + generateZodFixture würde entweder
// den Feldnamen-Hint verlieren (alle email-Fixtures bekämen denselben Wert —
// Unique-Constraints wären inkonsistent) oder einen hint-Parameter in die
// public API von generateZodFixture drücken, den externe Caller nie brauchen.
function buildEntityFixture(entity: EntityDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(entity.fields)) {
    const value = fieldToFixture(name, field);
    if (value !== undefined) out[name] = value;
  }
  return out;
}

function fieldToFixture(name: string, field: FieldDefinition): unknown {
  switch (field.type) {
    case "text": {
      if (field.format === "email") return `e2e-${name}@example.com`;
      if (field.format === "url") return "https://example.com";
      return `e2e ${name}`;
    }
    case "boolean":
      return true;
    case "select":
      return field.options[0] ?? "";
    case "multiSelect": {
      const first = field.options[0];
      return first ? [first] : [];
    }
    case "number":
      return 1;
    case "money":
      return { amount: 1, currency: "EUR" };
    case "date":
      return "2026-01-01";
    case "timestamp":
      return field.locatedBy !== undefined ? "2026-01-01T00:00:00" : "2026-01-01T00:00:00Z";
    case "tz":
      return "Europe/Berlin";
    case "locatedTimestamp":
      return { at: "2026-01-01T00:00:00", tz: "Europe/Berlin" };
    case "embedded": {
      const sub: Record<string, unknown> = {};
      for (const [subName, subDef] of Object.entries(field.schema)) {
        sub[subName] =
          subDef.type === "text"
            ? `e2e ${subName}`
            : subDef.type === "number"
              ? 1
              : subDef.type === "boolean"
                ? true
                : "2026-01-01";
      }
      return sub;
    }
    case "file":
    case "image":
    case "files":
    case "images":
      // File-Upload-Fixture ist noch nicht generisch: Playwright müsste
      // Dateiinhalte mitliefern, und die Write-API verlangt bereits ge-
      // uploadete fileRef-UUIDs. Lässt sich nachziehen, sobald Sample die
      // Pfade klärt (M4).
      return undefined;
    default:
      return undefined;
  }
}
