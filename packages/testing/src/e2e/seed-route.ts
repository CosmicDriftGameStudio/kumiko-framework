import { createHash, timingSafeEqual } from "node:crypto";
import {
  getInbox,
  mailTransportInMemoryFeature,
} from "@cosmicdrift/kumiko-bundled-features/mail-transport-inmemory";
import { TenantQueries } from "@cosmicdrift/kumiko-bundled-features/tenant";
import {
  type ExtraRouteDefinition,
  ExtraRouteRejection,
  type SignatureExtraRouteVerifyRequest,
  signatureRoute,
} from "@cosmicdrift/kumiko-framework/api";
import type { z } from "zod";
import {
  persistTenantRows,
  persistUserRows,
  type SeedWriter,
  unwrapSavedRow,
} from "../seed-tenant";
import { SEED_ENABLE_ENV, SEED_ROUTES, SEED_TOKEN_ENV, SEED_TOKEN_HEADER } from "./constants";
import {
  createSeedUserRequestSchema,
  inboxQuerySchema,
  seedTenantRequestSchema,
} from "./seed-contract";

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

// Shared by every verify() below — a failed parse becomes a 400 the same way
// the pre-#3050 handler-level parseJsonBody/parseWith checks did.
function parseOrReject<T>(value: ParsedBody<T>): T {
  if (value.success) return value.data;
  throw new ExtraRouteRejection(400, { error: value.error });
}

// Exported so a server entry that already mounts its own extraRoutes (instead
// of duplicating e2e/server.ts) can gate the *registration* itself — prod
// then never carries the seed routes at all, rather than relying solely on
// each route's own per-request assertGateOpen() check.
export function isE2eSeedingEnabled(): boolean {
  return process.env[SEED_ENABLE_ENV] === "1" && process.env["NODE_ENV"] !== "production";
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function tokenMatches(expected: string, provided: string | undefined): boolean {
  return provided !== undefined && timingSafeEqual(digest(expected), digest(provided));
}

// Runs first in every verify() below — replaces the old `app.use(prefix/*)`
// guard middleware now that entry:"signature" owns its own access control.
function assertGateOpen(request: SignatureExtraRouteVerifyRequest): void {
  // ExtraRouteRejection(status, body) always renders via c.json(body, status)
  // (buildExtraRouteHonoHandler) — the plain-text "Not Found" from the old
  // middleware becomes a JSON body; no test asserts the 404 body shape.
  if (!isE2eSeedingEnabled()) throw new ExtraRouteRejection(404, { error: "Not Found" });
  const expected = process.env[SEED_TOKEN_ENV];
  if (expected === undefined || expected === "") {
    throw new ExtraRouteRejection(500, {
      error: `${SEED_TOKEN_ENV} is not set; refusing to serve seed routes`,
    });
  }
  if (!tokenMatches(expected, request.headers[SEED_TOKEN_HEADER])) {
    throw new ExtraRouteRejection(401, { error: "invalid seed token" });
  }
}

export type E2eSeedRoutesOptions = {
  readonly extraRoles?: readonly string[];
};

// Builds the route definitions unconditionally (extraRoles validation must
// still throw in every environment) — the *mounting* decision is the
// caller's: use isE2eSeedingEnabled() to keep prod from ever registering
// these route objects at all, e.g. `...(isE2eSeedingEnabled() ?
// createE2eSeedRoutes() : [])` in a server entry that also runs in prod
// (kumiko-framework#3120). Each route's own assertGateOpen() 404s outside
// the seed condition regardless — this is belt-and-suspenders, not the only gate.
export function createE2eSeedRoutes(
  options: E2eSeedRoutesOptions = {},
): readonly ExtraRouteDefinition[] {
  const seedUserRequestSchema = createSeedUserRequestSchema(options.extraRoles);

  const seedTenantRoute = signatureRoute<z.infer<typeof seedTenantRequestSchema>>({
    method: "POST",
    path: SEED_ROUTES.seedTenant,
    entry: "signature",
    verify: async (request) => {
      assertGateOpen(request);
      return parseOrReject(parseJsonBody(seedTenantRequestSchema, request.rawBody));
    },
    handler: async (c, verified, deps) => {
      const write: SeedWriter = async (handlerQn, payload, tenantId) =>
        unwrapSavedRow(handlerQn, await deps.dispatchSystemWrite({ handlerQn, payload, tenantId }));
      try {
        return c.json(
          await persistTenantRows(write, { name: verified.name, users: verified.members }),
        );
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "seed failed" }, 500);
      }
    },
  });

  const seedUserRoute = signatureRoute<z.infer<typeof seedUserRequestSchema>>({
    method: "POST",
    path: SEED_ROUTES.seedUser,
    entry: "signature",
    verify: async (request) => {
      assertGateOpen(request);
      return parseOrReject(parseJsonBody(seedUserRequestSchema, request.rawBody));
    },
    handler: async (c, verified, deps) => {
      // No raw db in signature-route deps (fw#3050) — tenant:query:me, run as
      // a SystemAdmin scoped to verified.tenantId, is the existing
      // fetchOne(tenantTable, {id: tenantId}) lookup, just behind the dispatcher.
      const tenantRow = await deps.dispatchSystemQuery({
        handlerQn: TenantQueries.me,
        payload: {},
        tenantId: verified.tenantId,
      });
      if (tenantRow === null) {
        return c.json({ error: `unknown tenant ${verified.tenantId}` }, 404);
      }
      const write: SeedWriter = async (handlerQn, payload, tenantId) =>
        unwrapSavedRow(handlerQn, await deps.dispatchSystemWrite({ handlerQn, payload, tenantId }));
      try {
        return c.json(await persistUserRows(write, verified.tenantId, verified.roles));
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "seed failed" }, 500);
      }
    },
  });

  const inboxRoute = signatureRoute<z.infer<typeof inboxQuerySchema>>({
    method: "GET",
    path: SEED_ROUTES.inbox,
    entry: "signature",
    verify: async (request) => {
      assertGateOpen(request);
      return parseOrReject(
        parseWith(inboxQuerySchema, {
          tenantId: request.query["tenantId"],
          to: request.query["to"],
        }),
      );
    },
    handler: async (c, verified, deps) => {
      if (!deps.registry.features.has(mailTransportInMemoryFeature.name)) {
        return c.json(
          { error: `${mailTransportInMemoryFeature.name} is not mounted; no inbox to read` },
          501,
        );
      }
      const recipient = verified.to.toLowerCase();
      const messages = getInbox(verified.tenantId).filter(
        (message) => message.to.toLowerCase() === recipient,
      );
      return c.json({ messages });
    },
  });

  return [seedTenantRoute, seedUserRoute, inboxRoute];
}
