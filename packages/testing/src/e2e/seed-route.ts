import { createHash, timingSafeEqual } from "node:crypto";
import {
  getInbox,
  mailTransportInMemoryFeature,
} from "@cosmicdrift/kumiko-bundled-features/mail-transport-inmemory";
import { tenantTable } from "@cosmicdrift/kumiko-bundled-features/tenant";
import type { CreateKumikoServerOptions } from "@cosmicdrift/kumiko-dev-server";
import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type { z } from "zod";
import {
  persistTenantRows,
  persistUserRows,
  type SeedWriter,
  unwrapSavedRow,
} from "../seed-tenant";
import {
  SEED_ENABLE_ENV,
  SEED_ROUTE_PREFIX,
  SEED_ROUTES,
  SEED_TOKEN_ENV,
  SEED_TOKEN_HEADER,
} from "./constants";
import {
  createSeedUserRequestSchema,
  inboxQuerySchema,
  seedTenantRequestSchema,
} from "./seed-contract";

type ExtraRoutes = NonNullable<CreateKumikoServerOptions["extraRoutes"]>;

type ParsedBody<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string };

function parseWith<S extends z.ZodType>(schema: S, value: unknown): ParsedBody<z.infer<S>> {
  const result = schema.safeParse(value);
  if (result.success) return { success: true, data: result.data };
  const error = result.error.issues
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");
  return { success: false, error };
}

function parseJsonBody<S extends z.ZodType>(schema: S, raw: string): ParsedBody<z.infer<S>> {
  if (raw.trim() === "") return parseWith(schema, {});
  try {
    return parseWith(schema, JSON.parse(raw));
  } catch {
    return { success: false, error: "body: invalid JSON" };
  }
}

function seedingEnabled(): boolean {
  return process.env[SEED_ENABLE_ENV] === "1" && process.env["NODE_ENV"] !== "production";
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function tokenMatches(expected: string, provided: string | undefined): boolean {
  return provided !== undefined && timingSafeEqual(digest(expected), digest(provided));
}

export type E2eSeedRoutesOptions = {
  readonly extraRoles?: readonly string[];
};

export function createE2eSeedRoutes(options: E2eSeedRoutesOptions = {}): ExtraRoutes {
  const seedUserRequestSchema = createSeedUserRequestSchema(options.extraRoles);
  return (app, deps) => {
    const write: SeedWriter = async (handlerQn, payload, tenantId) =>
      unwrapSavedRow(handlerQn, await deps.dispatchSystemWrite({ handlerQn, payload, tenantId }));

    app.use(`${SEED_ROUTE_PREFIX}/*`, async (c, next) => {
      // c.notFound() would let the dev server answer unmatched GETs with its HTML shell (200).
      if (!seedingEnabled()) return c.text("Not Found", 404);
      const expected = process.env[SEED_TOKEN_ENV];
      if (expected === undefined || expected === "") {
        return c.json(
          { error: `${SEED_TOKEN_ENV} is not set; refusing to serve seed routes` },
          500,
        );
      }
      if (!tokenMatches(expected, c.req.header(SEED_TOKEN_HEADER))) {
        return c.json({ error: "invalid seed token" }, 401);
      }
      await next();
    });

    app.post(SEED_ROUTES.seedTenant, async (c) => {
      const body = parseJsonBody(seedTenantRequestSchema, await c.req.text());
      if (!body.success) return c.json({ error: body.error }, 400);
      try {
        return c.json(
          await persistTenantRows(write, { name: body.data.name, users: body.data.members }),
        );
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "seed failed" }, 500);
      }
    });

    app.post(SEED_ROUTES.seedUser, async (c) => {
      const body = parseJsonBody(seedUserRequestSchema, await c.req.text());
      if (!body.success) return c.json({ error: body.error }, 400);
      if ((await fetchOne(deps.db, tenantTable, { id: body.data.tenantId })) === undefined) {
        return c.json({ error: `unknown tenant ${body.data.tenantId}` }, 404);
      }
      try {
        return c.json(await persistUserRows(write, body.data.tenantId, body.data.roles));
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "seed failed" }, 500);
      }
    });

    app.get(SEED_ROUTES.inbox, (c) => {
      if (!deps.registry.features.has(mailTransportInMemoryFeature.name)) {
        return c.json(
          { error: `${mailTransportInMemoryFeature.name} is not mounted; no inbox to read` },
          501,
        );
      }
      const query = parseWith(inboxQuerySchema, {
        tenantId: c.req.query("tenantId"),
        to: c.req.query("to"),
      });
      if (!query.success) return c.json({ error: query.error }, 400);
      const recipient = query.data.to.toLowerCase();
      const messages = getInbox(query.data.tenantId).filter(
        (message) => message.to.toLowerCase() === recipient,
      );
      return c.json({ messages });
    });
  };
}
