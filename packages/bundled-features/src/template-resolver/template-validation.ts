import type {
  Registry,
  TemplateScalarVariableDef,
  TemplateVariableDef,
  TemplateVariables,
} from "@cosmicdrift/kumiko-framework/engine";
import type { Element as ScanElement } from "happy-dom";
import * as z from "zod";
import { conditionScopeElement, withParsedDocument } from "./document-sanitizer.ts";
import {
  DOCUMENT_CONDITION_ATTRIBUTE,
  isDocumentPlaceholderHref,
  isDocumentReferenceName,
} from "./document-schema.ts";
import type { TemplateMeta } from "./template-meta.ts";

export const SYSTEM_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "tenantName",
  "signature",
  "imprint",
  "unsubscribeUrl",
]);

const PAGE_PLACEHOLDERS = ["page", "pages"] as const;
const PAGED_KINDS: ReadonlySet<string> = new Set(["document-pdf", "pdf-layout"]);

export function systemPlaceholdersFor(kind: string): ReadonlySet<string> {
  return PAGED_KINDS.has(kind)
    ? new Set([...SYSTEM_PLACEHOLDERS, ...PAGE_PLACEHOLDERS])
    : SYSTEM_PLACEHOLDERS;
}

const BASE_RESOURCE_KEYS = ["logo"] as const;

export type TemplateValidation = {
  readonly unknown: readonly string[];
  readonly missingRequired: readonly string[];
  readonly used: readonly string[];
  /** data-resource keys with no uploaded file; a warning, never a blocker. */
  readonly unknownResources: readonly string[];
};

// Mirrors TemplateVariableDef: a stored or draft schema keeps its label and example, which the
// preview uses as sample values.
const variableCommon = {
  label: z.string().optional(),
  required: z.boolean().optional(),
};
const textLikeExample = z.string().optional();

const scalarVariableSchema = z.discriminatedUnion("type", [
  z.object({ ...variableCommon, type: z.literal("text"), example: textLikeExample }),
  z.object({ ...variableCommon, type: z.literal("link"), example: textLikeExample }),
  z.object({ ...variableCommon, type: z.literal("richText"), example: textLikeExample }),
  z.object({
    ...variableCommon,
    type: z.literal("money"),
    example: z
      .union([z.number(), z.object({ amount: z.number(), currency: z.string() })])
      .optional(),
  }),
  z.object({ ...variableCommon, type: z.literal("date"), example: textLikeExample }),
  z.object({ ...variableCommon, type: z.literal("percent"), example: z.number().optional() }),
]);

const variableDefSchema = z.union([
  scalarVariableSchema,
  z.object({
    ...variableCommon,
    type: z.literal("list"),
    item: z.record(z.string(), scalarVariableSchema),
    example: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
]);

// A stored variableSchema value is either a bare string (legacy "this is a text
// variable") or a TemplateVariableDef object; anything else is not declared and
// therefore shows up as an unknown placeholder instead of being guessed at.
function toVariableDef(raw: unknown): TemplateVariableDef | null {
  if (typeof raw === "string") return { type: "text" };
  const parsed = variableDefSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function resolveTemplateVariables(
  registry: Registry,
  slug: string,
  variableSchema: Readonly<Record<string, unknown>>,
): TemplateVariables {
  const declared = registry.getAllNotifications().get(slug)?.variables;
  return declared ?? variablesFromSchema(variableSchema);
}

export function variablesFromSchema(
  variableSchema: Readonly<Record<string, unknown>>,
): TemplateVariables {
  const variables: Record<string, TemplateVariableDef> = {};
  for (const [name, raw] of Object.entries(variableSchema)) {
    const def = toVariableDef(raw);
    if (def !== null) variables[name] = def;
  }
  return variables;
}

type Resolution = { readonly known: boolean; readonly used: string };

function rootName(name: string): string {
  return name.split(".")[0] ?? name;
}

type PlaceholderScope = {
  readonly variables: TemplateVariables;
  readonly systemPlaceholders: ReadonlySet<string>;
  readonly resourceKeys: ReadonlySet<string>;
  readonly used: Set<string>;
  readonly unknown: Set<string>;
  readonly unknownResources: Set<string>;
};

function listItemFields(
  variables: TemplateVariables,
  listName: string | null,
): Readonly<Record<string, TemplateScalarVariableDef>> {
  const def =
    listName !== null && Object.hasOwn(variables, listName) ? variables[listName] : undefined;
  return def?.type === "list" ? def.item : {};
}

function isKnownName(
  name: string,
  scope: PlaceholderScope,
  itemFields: Readonly<Record<string, unknown>>,
): Resolution {
  const { variables } = scope;
  const root = rootName(name);
  // Declared variables and item fields are scalars: a dotted path under one never renders a value.
  if (Object.hasOwn(itemFields, name)) return { known: true, used: "" };
  if (scope.systemPlaceholders.has(root)) return { known: true, used: "" };
  if (Object.hasOwn(variables, name)) return { known: true, used: name };
  return { known: false, used: "" };
}

function recordName(
  name: string,
  itemFields: Readonly<Record<string, unknown>>,
  scope: PlaceholderScope,
) {
  const resolution = isKnownName(name, scope, itemFields);
  if (!resolution.known) scope.unknown.add(name);
  else if (resolution.used !== "") scope.used.add(resolution.used);
}

function enclosingEachName(element: ScanElement): string | null {
  return element.closest("tr[data-each]")?.getAttribute("data-each") ?? null;
}

const NAME_ATTRIBUTE_BY_TAG: Readonly<Record<string, string>> = {
  span: "data-variable",
  div: "data-steps",
};

function scanRepeatRows(root: ScanElement, scope: PlaceholderScope): void {
  for (const element of Array.from(root.querySelectorAll("tr[data-each]"))) {
    const listName = element.getAttribute("data-each") ?? "";
    const def = Object.hasOwn(scope.variables, listName) ? scope.variables[listName] : undefined;
    if (def?.type === "list") scope.used.add(listName);
    else scope.unknown.add(listName);
  }
}

function scanConditions(root: ScanElement, scope: PlaceholderScope): void {
  for (const element of Array.from(root.querySelectorAll(`[${DOCUMENT_CONDITION_ATTRIBUTE}]`))) {
    const itemFields = listItemFields(
      scope.variables,
      enclosingEachName(conditionScopeElement(element)),
    );
    recordName(element.getAttribute(DOCUMENT_CONDITION_ATTRIBUTE) ?? "", itemFields, scope);
  }
}

function scanReferences(root: ScanElement, scope: PlaceholderScope): void {
  for (const element of Array.from(
    root.querySelectorAll("span[data-variable], div[data-steps], a[href], img[data-resource]"),
  )) {
    const itemFields = listItemFields(scope.variables, enclosingEachName(element));
    const tag = element.tagName.toLowerCase();
    const nameAttribute = NAME_ATTRIBUTE_BY_TAG[tag];
    if (nameAttribute !== undefined) {
      recordName(element.getAttribute(nameAttribute) ?? "", itemFields, scope);
    } else if (tag === "a") {
      const href = element.getAttribute("href") ?? "";
      if (isDocumentPlaceholderHref(href)) recordName(href.slice(2, -2), itemFields, scope);
    } else {
      const key = element.getAttribute("data-resource") ?? "";
      if (!scope.resourceKeys.has(key)) scope.unknownResources.add(key);
    }
  }
}

function scanBodyPlaceholders(body: string, scope: PlaceholderScope): void {
  withParsedDocument(body, (root) => {
    scanRepeatRows(root, scope);
    scanConditions(root, scope);
    scanReferences(root, scope);
  });
}

const HANDLEBARS_EXPRESSION = /\{\{([^{}]*)\}\}/g;

// Meta text supports only plain `{{name}}` references; every other
// Handlebars construct is reported as unknown so it can never reach the compiler.
function scanMetaPlaceholders(text: string, scope: PlaceholderScope): void {
  const leftover = text.replace(HANDLEBARS_EXPRESSION, (_match, inner: string) => {
    const name = inner.trim();
    if (isDocumentReferenceName(name)) recordName(name, {}, scope);
    else scope.unknown.add(`{{${inner}}}`);
    return "";
  });
  if (/[{}]/.test(leftover)) scope.unknown.add("{");
}

function metaTexts(meta: TemplateMeta | null): readonly string[] {
  if (meta === null || !("subject" in meta)) return [];
  return [meta.subject, meta.previewText, meta.headerChip, meta.tone, meta.footerNote].filter(
    (text): text is string => text !== undefined,
  );
}

export function validateTemplatePlaceholders(input: {
  readonly kind: string;
  readonly body: string;
  readonly meta: TemplateMeta | null;
  readonly variables: TemplateVariables;
  /** data-resource keys with an uploaded file besides the built-in `logo`. */
  readonly resourceKeys?: readonly string[];
}): TemplateValidation {
  const scope: PlaceholderScope = {
    variables: input.variables,
    systemPlaceholders: systemPlaceholdersFor(input.kind),
    resourceKeys: new Set([...BASE_RESOURCE_KEYS, ...(input.resourceKeys ?? [])]),
    used: new Set(),
    unknown: new Set(),
    unknownResources: new Set(),
  };
  scanBodyPlaceholders(input.body, scope);
  for (const text of metaTexts(input.meta)) scanMetaPlaceholders(text, scope);
  const missingRequired = Object.entries(input.variables)
    .filter(([name, def]) => def.required === true && !scope.used.has(name))
    .map(([name]) => name);
  return {
    unknown: [...scope.unknown].sort(),
    missingRequired: missingRequired.sort(),
    used: [...scope.used].sort(),
    unknownResources: [...scope.unknownResources].sort(),
  };
}

export function hasPlaceholderProblems(validation: TemplateValidation): boolean {
  return validation.unknown.length > 0 || validation.missingRequired.length > 0;
}
