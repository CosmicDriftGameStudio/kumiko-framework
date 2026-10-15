import type {
  Registry,
  TemplateScalarVariableDef,
  TemplateVariableDef,
  TemplateVariables,
} from "@cosmicdrift/kumiko-framework/engine";
import type { Element as ScanElement } from "happy-dom";
import * as z from "zod";
import { withParsedDocument } from "./document-sanitizer.js";
import { isDocumentPlaceholderHref, isDocumentReferenceName } from "./document-schema.js";
import type { TemplateMeta } from "./template-meta.js";

export const SYSTEM_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "tenantName",
  "signature",
  "imprint",
  "unsubscribeUrl",
]);

const ALLOWED_RESOURCE_KEYS: ReadonlySet<string> = new Set(["logo"]);

export type TemplateValidation = {
  readonly unknown: readonly string[];
  readonly missingRequired: readonly string[];
  readonly used: readonly string[];
};

const SCALAR_TYPES = ["text", "link", "money", "date"] as const;

const scalarVariableSchema = z.object({
  type: z.enum(SCALAR_TYPES),
  required: z.boolean().optional(),
});

const variableDefSchema = z.union([
  scalarVariableSchema,
  z.object({
    type: z.literal("list"),
    required: z.boolean().optional(),
    item: z.record(z.string(), scalarVariableSchema),
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
  readonly used: Set<string>;
  readonly unknown: Set<string>;
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
  variables: TemplateVariables,
  itemFields: Readonly<Record<string, unknown>>,
): Resolution {
  const root = rootName(name);
  if (Object.hasOwn(itemFields, name) || Object.hasOwn(itemFields, root)) {
    return { known: true, used: "" };
  }
  if (SYSTEM_PLACEHOLDERS.has(root)) return { known: true, used: "" };
  if (Object.hasOwn(variables, name)) return { known: true, used: name };
  if (Object.hasOwn(variables, root)) return { known: true, used: root };
  return { known: false, used: "" };
}

function recordName(
  name: string,
  itemFields: Readonly<Record<string, unknown>>,
  scope: PlaceholderScope,
) {
  const resolution = isKnownName(name, scope.variables, itemFields);
  if (!resolution.known) scope.unknown.add(name);
  else if (resolution.used !== "") scope.used.add(resolution.used);
}

function enclosingEachName(element: ScanElement): string | null {
  return element.closest("tr[data-each]")?.getAttribute("data-each") ?? null;
}

function scanBodyPlaceholders(body: string, scope: PlaceholderScope): void {
  withParsedDocument(body, (root) => {
    for (const element of Array.from(root.querySelectorAll("tr[data-each]"))) {
      const listName = element.getAttribute("data-each") ?? "";
      const def = Object.hasOwn(scope.variables, listName) ? scope.variables[listName] : undefined;
      if (def?.type === "list") scope.used.add(listName);
      else scope.unknown.add(listName);
    }
    for (const element of Array.from(
      root.querySelectorAll("span[data-variable], a[href], img[data-resource]"),
    )) {
      const itemFields = listItemFields(scope.variables, enclosingEachName(element));
      const tag = element.tagName.toLowerCase();
      if (tag === "span") {
        recordName(element.getAttribute("data-variable") ?? "", itemFields, scope);
      } else if (tag === "a") {
        const href = element.getAttribute("href") ?? "";
        if (isDocumentPlaceholderHref(href)) recordName(href.slice(2, -2), itemFields, scope);
      } else {
        const key = element.getAttribute("data-resource") ?? "";
        if (!ALLOWED_RESOURCE_KEYS.has(key)) scope.unknown.add(key);
      }
    }
  });
}

const HANDLEBARS_EXPRESSION = /\{\{([^{}]*)\}\}/g;

// Meta text supports only plain `{{name}}` / `{{name.field}}`; every other
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
  return [meta.subject, ...(meta.previewText === undefined ? [] : [meta.previewText])];
}

export function validateTemplatePlaceholders(input: {
  readonly body: string;
  readonly meta: TemplateMeta | null;
  readonly variables: TemplateVariables;
}): TemplateValidation {
  const scope: PlaceholderScope = {
    variables: input.variables,
    used: new Set(),
    unknown: new Set(),
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
  };
}

export function hasPlaceholderProblems(validation: TemplateValidation): boolean {
  return validation.unknown.length > 0 || validation.missingRequired.length > 0;
}
