import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";

type SchemaNode = Readonly<Record<string, unknown>>;

export type FieldRow = {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  /** Raw JSON Schema `description`, used when no label exists. */
  readonly schemaDescription: string | undefined;
};

// Recursive schemas would otherwise expand forever in examples and type labels.
const MAX_SCHEMA_DEPTH = 6;

const FORMAT_EXAMPLES: Readonly<Record<string, string>> = {
  uuid: "00000000-0000-4000-8000-000000000001",
  "date-time": "2026-01-15T09:30:00.000Z",
  date: "2026-01-15",
  email: "user@example.com",
  uri: "https://example.com",
};

const DEFAULT_STRING_EXAMPLE = "text";

function asNode(value: unknown): SchemaNode | undefined {
  return isPlainObject(value) ? value : undefined;
}

function nodeList(value: unknown): readonly SchemaNode[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const node = asNode(entry);
        return node === undefined ? [] : [node];
      })
    : [];
}

function isNullNode(node: SchemaNode): boolean {
  return node["type"] === "null";
}

function resolveRef(node: SchemaNode, root: SchemaNode): SchemaNode {
  const ref = node["$ref"];
  if (typeof ref !== "string" || !ref.startsWith("#/")) return node;
  let target: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    target = asNode(target)?.[part];
  }
  return asNode(target) ?? node;
}

function alternatives(node: SchemaNode): readonly SchemaNode[] {
  return [...nodeList(node["anyOf"]), ...nodeList(node["oneOf"])];
}

export function typeLabel(rawNode: SchemaNode, root: SchemaNode = rawNode, depth = 0): string {
  const node = resolveRef(rawNode, root);
  if (depth > MAX_SCHEMA_DEPTH) return "object";
  const options = alternatives(node);
  if (options.length > 0) {
    const nonNull = options.filter((option) => !isNullNode(option));
    const labels = nonNull.map((option) => typeLabel(option, root, depth + 1));
    return [...labels, ...(nonNull.length < options.length ? ["null"] : [])].join(" | ");
  }
  if (Array.isArray(node["enum"]))
    return node["enum"].map((value) => JSON.stringify(value)).join(" | ");
  if ("const" in node) return JSON.stringify(node["const"]);
  const type = node["type"];
  if (type === "array") {
    const items = asNode(node["items"]);
    return `array of ${items === undefined ? "any" : typeLabel(items, root, depth + 1)}`;
  }
  if (type === "string") {
    const format = node["format"];
    return typeof format === "string" ? `string (${format})` : "string";
  }
  if (type === "object") return "object";
  return typeof type === "string" ? type : "any";
}

function rowsOf(schema: SchemaNode, root: SchemaNode, prefix: string): readonly FieldRow[] {
  const properties = asNode(schema["properties"]);
  if (properties === undefined) return [];
  const required = new Set(
    Array.isArray(schema["required"])
      ? schema["required"].filter((n) => typeof n === "string")
      : [],
  );
  return Object.entries(properties).map(([name, value]) => {
    const node = asNode(value) ?? {};
    const description = node["description"];
    return {
      name: prefix + name,
      type: typeLabel(node, root),
      required: required.has(name),
      schemaDescription: typeof description === "string" ? description : undefined,
    };
  });
}

/** One row per top-level field; an object field with known properties (`changes` of a
 *  CRUD update) is followed by its own properties as `parent.child` rows, one level deep. */
export function fieldRows(schema: SchemaNode | undefined): readonly FieldRow[] {
  if (schema === undefined) return [];
  const properties = asNode(schema["properties"]) ?? {};
  return rowsOf(schema, schema, "").flatMap((row) => {
    const node = resolveRef(asNode(properties[row.name]) ?? {}, schema);
    return [row, ...rowsOf(node, schema, `${row.name}.`)];
  });
}

function stringExample(node: SchemaNode): string {
  const format = node["format"];
  return (
    (typeof format === "string" ? FORMAT_EXAMPLES[format] : undefined) ?? DEFAULT_STRING_EXAMPLE
  );
}

function objectExample(node: SchemaNode, root: SchemaNode, depth: number): Record<string, unknown> {
  const properties = asNode(node["properties"]) ?? {};
  return Object.fromEntries(
    Object.entries(properties).map(([name, value]) => [
      name,
      examplePayload(asNode(value) ?? {}, root, depth + 1),
    ]),
  );
}

/** A request value that satisfies the schema's shape; optional fields are included
 *  so the example shows every field a caller may send. */
export function examplePayload(
  rawNode: SchemaNode,
  root: SchemaNode = rawNode,
  depth = 0,
): unknown {
  const node = resolveRef(rawNode, root);
  if (depth > MAX_SCHEMA_DEPTH) return null;
  const options = alternatives(node);
  if (options.length > 0) {
    const first = options.find((option) => !isNullNode(option)) ?? options[0];
    return first === undefined ? null : examplePayload(first, root, depth + 1);
  }
  if (Array.isArray(node["enum"])) return node["enum"][0];
  if ("const" in node) return node["const"];
  return typedExample(node, root, depth);
}

function typedExample(node: SchemaNode, root: SchemaNode, depth: number): unknown {
  switch (node["type"]) {
    case "string":
      return stringExample(node);
    case "number":
    case "integer":
      return 1;
    case "boolean":
      return true;
    case "array": {
      const items = asNode(node["items"]);
      return items === undefined ? [] : [examplePayload(items, root, depth + 1)];
    }
    case "object":
      return objectExample(node, root, depth);
    default:
      return null;
  }
}
