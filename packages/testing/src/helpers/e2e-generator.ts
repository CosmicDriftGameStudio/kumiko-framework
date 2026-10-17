// @runtime tooling
//
// E2E generator: derives structured TestSpecs from the registry.
//
// Every r.screen(...) is a testable surface. The generator iterates
// getAllScreens() and builds one set of TestSpecs per screen (four kinds, one
// per "what must work at minimum"). The specs are JSON-serializable: consumers
// write them to disk as JSON via a bun script, and a Playwright globalSetup
// triggers that before every run. The Playwright runner reads the JSON and
// iterates it with kind-specific handlers against the real renderer.
//
// Why two processes: the framework runtime (registry, drizzle, ioredis types,
// etc.) must NEVER load inside the Playwright worker. It would collide with
// Playwright's Object.prototype symbols ($$jest-matchers-object) and crash the
// worker on spec import.
//
// Two stages, each testable on its own:
//   1. generateE2ESpec(registry)   — Registry → TestSpec[]
//   2. generateZodFixture(schema)  — ZodType  → plausible value
//
// Stage 2 is intentionally minimal: string/number/boolean/date/enum/uuid plus
// ZodOptional/ZodDefault unwrapping. Everything else throws "not supported
// yet" and gets added when a real caller needs it; faked complex values would
// only produce false-green tests.

import {
  type EntityDefinition,
  type EntityEditScreenDefinition,
  type EntityListScreenDefinition,
  type FieldDefinition,
  isFieldsEditSection,
  normalizeEditField,
  normalizeListColumn,
  parseQn,
  qn,
  type Registry,
  sectionFieldSpecs,
  toKebab,
} from "@cosmicdrift/kumiko-framework/engine";
import type * as z from "zod";

// --- Spec-Shape ---

// Each TestSpec variant carries everything the renderer needs for templating:
// no registry reference, no lazy lookups. That keeps specs JSON-serializable
// (debug dump, snapshot comparison) and the renderer pure template.
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

// Structured instruction for the edit-save-persists renderer. The fixture alone
// cannot say whether a string belongs in a text field (`.fill`) or a dropdown
// (`.selectOption`); the generator decides from the FieldDefinition, the
// renderer only templates.
export type EditFillOp =
  | { readonly kind: "fill"; readonly field: string; readonly value: string }
  | { readonly kind: "check"; readonly field: string; readonly value: boolean }
  | { readonly kind: "select"; readonly field: string; readonly value: string };

export type E2EGeneratorOptions = {
  // Tenant slug/UUID as template placeholder. Defaults to "{tenant}", which the
  // test runner replaces at run time. Set a slug here for fixed tenant-scoped URLs.
  readonly tenantPlaceholder?: string;
};

// --- Stage 1: spec derivation from the registry ---

export function generateE2ESpec(
  registry: Registry,
  options: E2EGeneratorOptions = {},
): readonly E2ETestSpec[] {
  const tenant = options.tenantPlaceholder ?? "{tenant}";
  const specs: E2ETestSpec[] = [];

  for (const [screenQn, screen] of registry.getAllScreens()) {
    if (screen.type === "custom") continue; // no generic assumption possible
    // actionForm: no generic E2E spec; the author-defined handler needs
    // author-defined test data the generator does not know.
    if (screen.type === "actionForm") continue;
    // secretMint: same reasoning — author-defined write handler, no generic spec.
    if (screen.type === "secretMint") continue;
    // configEdit: same reasoning. Values are written per field via
    // config:write:set, so a spec without CRUD state would be worthless.
    // Branding/SMTP/etc. are author-specific.
    if (screen.type === "configEdit") continue;
    // secretsEdit: dito — writes go through secrets:write:set with
    // plaintext values the generator has no author-defined test data for.
    if (screen.type === "secretsEdit") continue;
    // projectionList: query-driven, author-specific projection; no generic
    // CRUD spec derivable (like actionForm/configEdit).
    if (screen.type === "projectionList") continue;
    // projectionDetail: same reasoning; read-only single-row inspector, no CRUD state.
    if (screen.type === "projectionDetail") continue;
    // dashboard: panel-driven (stat/chart/list queries); same reasoning, no
    // generic CRUD assumption possible.
    if (screen.type === "dashboard") continue;
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
  // feature.writeHandlers is keyed by short name ("task:create"), but the
  // registry lookup needs the qualified form ("tasks:write:task:create").
  // Qualify via qn() + toKebab like the registry itself; that is the contract
  // from qualified-name.ts.
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
    if (!isFieldsEditSection(section)) continue;
    for (const rawField of sectionFieldSpecs(section)) {
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
  // First text column with a fixture value: the visually most reliable
  // identification in a generic table.
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
  // Walk the layout order so the result mirrors what a user actually fills in.
  // The interaction kind is decided per field type; fields without a fixture
  // value (file/image/…) are skipped.
  const ops: EditFillOp[] = [];
  for (const section of screen.layout.sections) {
    if (!isFieldsEditSection(section)) continue;
    for (const raw of sectionFieldSpecs(section)) {
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
        case "longText":
        case "number":
        case "date":
        case "tz":
          // date: a text input that accepts typed ISO values directly.
          ops.push({ kind: "fill", field, value: String(v) });
          break;
        // embedded/money/timestamp/locatedTimestamp/file/image/files/images:
        // no generic interaction. Since #369 timestamp renders two inputs
        // (date + time) that a single .fill() cannot drive; the test author
        // supplies a hand override or skips it.
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
  // Prefer a field that appears as a column in the list screen; otherwise the
  // "shows up in the list" assertion cannot be performed.
  const columns = listScreen
    ? new Set(listScreen.columns.map((c) => normalizeListColumn(c).field))
    : undefined;

  for (const section of editScreen.layout.sections) {
    if (!isFieldsEditSection(section)) continue;
    for (const rawField of sectionFieldSpecs(section)) {
      const { field } = normalizeEditField(rawField);
      if (entity.fields[field]?.type !== "text") continue;
      if (columns && !columns.has(field)) continue;
      const v = fixture[field];
      if (typeof v === "string" && v.length > 0) return { field, value: v };
    }
  }
  return undefined;
}

// --- Stage 2: Zod fixture ---

// Zod 4 stabilizes introspection on `._def.type` (lowercase discriminator),
// `._def.format` for string formats (email/url/uuid/datetime), `._def.entries`
// for enums and `._def.innerType` for optional/default/nullable. We access
// exactly these fields, the shape our buildInsertSchema emits. Other types
// throw "not supported yet" until a sample concretely needs them.

type ZodInternals = {
  readonly type?: string;
  readonly format?: string;
  readonly innerType?: z.ZodTypeAny;
  readonly entries?: Record<string, string>;
  readonly out?: z.ZodTypeAny;
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
    case "pipe": {
      if (!def?.out) throw new Error("zod pipe without out");
      return generateZodFixture(def.out);
    }
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

// --- Fixture from FieldDefinition (stage 1, instead of a Zod schema) ---
//
// Deliberate duplicate of generateZodFixture; the two have different jobs:
//   generateZodFixture   — public, generic, knows only Zod primitives
//   buildEntityFixture   — internal, Kumiko domain, knows file skipping,
//                          embedded shape, money/tz objects and uses the field
//                          name for readable prefixes ("e2e-email@...")
//
// Merging them via buildInsertSchema + generateZodFixture would either lose the
// field-name hint (all email fixtures would get the same value, making unique
// constraints inconsistent) or push a hint parameter into the public API of
// generateZodFixture that external callers never need.
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
    case "longText":
      // longText has no format options; a generic placeholder is enough.
      return `e2e ${name} (long-form content)`;
    case "boolean":
      return true;
    case "select": {
      const conditional = new Set(field.conditionalOptions?.flatMap((rule) => rule.options));
      return (
        field.default ??
        field.options.find((option) => !conditional.has(option)) ??
        field.options[0] ??
        ""
      );
    }
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
            : subDef.type === "number" || subDef.type === "decimal"
              ? 1
              : subDef.type === "money"
                ? 100
                : subDef.type === "boolean"
                  ? true
                  : "2026-01-01";
      }
      return field.multiple === true ? [sub] : sub;
    }
    case "jsonb":
      // Free-form jsonb — e2e-generator returns empty-object.
      return {};
    case "file":
    case "image":
    case "files":
    case "images":
      // File-upload fixtures are not generic yet: Playwright would have to supply
      // file contents, and the write API already expects uploaded fileRef UUIDs.
      // Can be added once a sample settles the paths (M4).
      return undefined;
    default:
      return undefined;
  }
}
