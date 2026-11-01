import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { compareIds } from "../labels.ts";
import { documentedErrorRows } from "./error-table.ts";
import type { ApiDocsEvent, ApiDocsHandler, ApiDocsModel, ApiDocsSource } from "./model.ts";
import { describeEvent } from "./render-events.ts";
import { apiDocsTextsFor, isApiDocsLocale } from "./texts/index.ts";

type Json = Readonly<Record<string, unknown>>;

const SCHEMAS = "#/components/schemas";
const JSON_CONTENT = "application/json";

const schemaName = (qn: string): string => qn.replaceAll(":", ".");

const ref = (name: string): Json => ({ $ref: `${SCHEMAS}/${name}` });

// Entity events are `entity.verb`: a different suffix keeps them apart from a declared
// `feature:name` event that would map to the same dotted name.
const eventSchemaName = (event: ApiDocsEvent): string =>
  event.origin === "entity" ? `${event.qn}.entity-event` : `${schemaName(event.qn)}.event`;

/** Embedded input schemas are standalone documents: drop `$schema` (OpenAPI 3.1 sets
 *  the dialect once) and hoist their `$defs` into components so local refs keep resolving. */
function embedSchema(schema: Json, name: string, hoisted: Record<string, unknown>): unknown {
  const defs = isPlainObject(schema["$defs"]) ? schema["$defs"] : {};
  const rewrite = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(rewrite);
    if (!isPlainObject(node)) return node;
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => key !== "$schema" && key !== "$defs")
        .map(([key, value]) => {
          if (key === "$ref" && typeof value === "string" && value.startsWith("#/$defs/")) {
            return [key, `${SCHEMAS}/${name}.${value.slice("#/$defs/".length)}`];
          }
          return [key, rewrite(value)];
        }),
    );
  };
  for (const [defName, def] of Object.entries(defs)) hoisted[`${name}.${defName}`] = rewrite(def);
  return rewrite(schema);
}

function requestWrapper(handler: ApiDocsHandler, description: string | undefined): Json {
  return {
    type: "object",
    ...(description !== undefined && { description }),
    required: ["type", "payload"],
    properties: {
      type: { const: handler.qn },
      payload: ref(`${schemaName(handler.qn)}.payload`),
      requestId: { type: "string" },
    },
  };
}

function oneOfRequests(handlers: readonly ApiDocsHandler[]): Json {
  return {
    oneOf: handlers.map((handler) => ref(`${schemaName(handler.qn)}.request`)),
    discriminator: {
      propertyName: "type",
      mapping: Object.fromEntries(
        handlers.map((handler) => [handler.qn, `${SCHEMAS}/${schemaName(handler.qn)}.request`]),
      ),
    },
  };
}

function errorResponses(): Json {
  const statuses = [
    ...new Set(documentedErrorRows(apiDocsTextsFor("en")).map((row) => row.status)),
  ];
  return Object.fromEntries(
    statuses
      .sort((a, b) => a - b)
      .map((status) => [
        String(status),
        { description: "Error", content: { [JSON_CONTENT]: { schema: ref("ErrorEnvelope") } } },
      ]),
  );
}

function operation(summary: string, requestBody: Json, dataSchema: Json): Json {
  return {
    post: {
      summary,
      requestBody: { required: true, content: { [JSON_CONTENT]: { schema: requestBody } } },
      responses: {
        "200": {
          description: "Success",
          content: {
            [JSON_CONTENT]: {
              schema: {
                type: "object",
                properties: { isSuccess: { type: "boolean" }, data: dataSchema },
              },
            },
          },
        },
        ...errorResponses(),
      },
    },
  };
}

function webhooks(events: readonly ApiDocsEvent[], locale: string): Json {
  const texts = apiDocsTextsFor(isApiDocsLocale(locale) ? locale : "en");
  return Object.fromEntries(
    events.map((event) => [
      event.qn,
      {
        post: {
          summary: event.qn,
          description: describeEvent(event, locale, texts),
          requestBody: {
            required: true,
            content: { [JSON_CONTENT]: { schema: ref(eventSchemaName(event)) } },
          },
          "x-kumiko-version": event.version,
          "x-kumiko-scope": event.domains.map((domain) => `${domain}:read`),
        },
      },
    ]),
  );
}

export type OpenApiInput = {
  readonly model: ApiDocsModel;
  readonly source: ApiDocsSource;
  readonly baseUrl: string;
  readonly appName: string;
  /** Locale the operation descriptions are taken from. */
  readonly descriptionLocale: string;
};

export function renderOpenApi(input: OpenApiInput): string {
  const { model } = input;
  const schemas: Record<string, unknown> = {};
  for (const handler of model.handlers) {
    const name = schemaName(handler.qn);
    schemas[`${name}.request`] = requestWrapper(
      handler,
      handler.description[input.descriptionLocale],
    );
    schemas[`${name}.payload`] = embedSchema(
      handler.inputSchema ?? { type: "object" },
      `${name}.payload`,
      schemas,
    );
  }
  for (const event of model.events) {
    const name = eventSchemaName(event);
    schemas[name] = embedSchema(event.payloadSchema ?? { type: "object" }, name, schemas);
  }
  const errorCodes = [
    ...new Set(documentedErrorRows(apiDocsTextsFor("en")).map((r) => r.code)),
  ].sort(compareIds);
  schemas["ErrorEnvelope"] = {
    type: "object",
    required: ["error"],
    properties: {
      isSuccess: { type: "boolean" },
      error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: { type: "string", enum: errorCodes },
          httpStatus: { type: "integer" },
          message: { type: "string" },
          details: { type: "object" },
        },
      },
    },
  };

  const queries = model.handlers.filter((handler) => handler.kind === "query");
  const writes = model.handlers.filter((handler) => handler.kind === "write");
  const paths: Record<string, unknown> = {
    ...(queries.length > 0 && { "/api/query": operation("Query", oneOfRequests(queries), {}) }),
    ...(writes.length > 0 && {
      "/api/write": operation("Write", oneOfRequests(writes), {}),
      "/api/batch": operation(
        "Batch",
        {
          type: "object",
          required: ["commands"],
          properties: {
            commands: { type: "array", items: oneOfRequests(writes) },
            requestId: { type: "string" },
          },
        },
        { type: "array" },
      ),
    }),
  };

  return `${JSON.stringify(
    {
      openapi: "3.1.0",
      info: { title: `${input.appName} API`, version: input.source.app.version },
      servers: [{ url: input.baseUrl }],
      security: [{ bearerAuth: [] }],
      paths,
      ...(model.events.length > 0 && {
        webhooks: webhooks(model.events, input.descriptionLocale),
      }),
      components: {
        securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
        schemas,
      },
    },
    null,
    2,
  )}\n`;
}
