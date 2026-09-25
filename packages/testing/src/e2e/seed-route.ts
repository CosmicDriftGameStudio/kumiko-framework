import { createHash, timingSafeEqual } from "node:crypto";
import type { EmailMessage } from "@cosmicdrift/kumiko-bundled-features/channel-email";
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
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import {
  persistTenantRows,
  persistUserRows,
  type SeedWriter,
  unwrapSavedRow,
  unwrapWriteData,
} from "../seed-tenant";
import { SEED_ENABLE_ENV, SEED_ROUTES, SEED_TOKEN_ENV, SEED_TOKEN_HEADER } from "./constants";
import {
  type CapturedMail,
  createSeedUserRequestSchema,
  extraSeedRequestSchema,
  inboxQuerySchema,
  seedTenantRequestSchema,
} from "./seed-contract";

type ParsedBody<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string };

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");
}

function parseWith<S extends z.ZodType>(schema: S, value: unknown): ParsedBody<z.infer<S>> {
  const result = schema.safeParse(value);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: formatIssues(result.error) };
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

// Every call runs with system privileges inside the one seeded tenant the
// route verified; there is no way to address another tenant through it.
export type E2eSeederContext = {
  readonly write: (handlerQn: string, payload: unknown) => Promise<unknown>;
  readonly query: (handlerQn: string, payload: unknown) => Promise<unknown>;
};

// `body` is whatever the client sent; validate it with a zod schema's parse(),
// a ZodError becomes a 400. The return value goes back as JSON `{ result }`.
export type E2eExtraSeeder = (
  ctx: E2eSeederContext,
  tenantId: TenantId,
  body: unknown,
) => Promise<unknown>;

type VerifiedExtraSeed = {
  readonly seederName: string;
  readonly seeder: E2eExtraSeeder;
  readonly tenantId: TenantId;
  readonly body: unknown;
};

export type E2eSeedRoutesOptions = {
  readonly extraRoles?: readonly string[];
  // Reachable only through tenant.seed(name, body) and only for tenants the
  // seed-tenant route of this same server seeded.
  readonly extraSeeders?: Readonly<Record<string, E2eExtraSeeder>>;
  // Apps that send tenantless mail (signup/forgot-password/magic-link) via
  // their own raw createInMemoryTransport() pass its `sent` array here so
  // the inbox route can read it without a tenantId. Independent of
  // mailTransportInMemoryFeature — both sources may be present at once.
  readonly mailOutbox?: { readonly sent: readonly EmailMessage[] };
};

function toCapturedMail(message: EmailMessage): CapturedMail {
  return {
    to: message.to,
    subject: message.subject,
    html: message.html,
    ...(message.from !== undefined ? { from: message.from } : {}),
    ...(message.replyTo !== undefined ? { replyTo: message.replyTo } : {}),
    ...(message.headers !== undefined ? { headers: message.headers } : {}),
  };
}

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
  const extraSeeders = options.extraSeeders ?? {};
  // In-memory on purpose: the seed token is known to every test client, so
  // only server-side state can tell a tenant this server seeded from any
  // other tenant id a client might send.
  const seededTenantIds = new Set<string>();

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
        const persisted = await persistTenantRows(write, {
          name: verified.name,
          users: verified.members,
          admin: verified.admin,
        });
        seededTenantIds.add(persisted.id);
        return c.json(persisted);
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
      const recipient = verified.to.toLowerCase();
      const isRecipient = (message: { readonly to: string }) =>
        message.to.toLowerCase() === recipient;

      const tenantId = verified.tenantId;
      const mailOutbox = options.mailOutbox;
      const hasTenantSource =
        tenantId !== undefined && deps.registry.features.has(mailTransportInMemoryFeature.name);
      if (!hasTenantSource && mailOutbox === undefined) {
        return c.json(
          {
            error:
              `no inbox to read: neither ${mailTransportInMemoryFeature.name} is mounted with a ` +
              "tenantId nor was mailOutbox passed to createE2eSeedRoutes()",
          },
          501,
        );
      }

      // Both sources may be present; concatenation order between them is
      // undefined (neither carries a timestamp). Within each source, newest
      // first — that ordering is what mailCapture and its tests rely on.
      const tenantMessages =
        hasTenantSource && tenantId !== undefined
          ? [...getInbox(tenantId)].filter(isRecipient).reverse().map(toCapturedMail)
          : [];
      const outboxMessages =
        mailOutbox !== undefined
          ? [...mailOutbox.sent].filter(isRecipient).reverse().map(toCapturedMail)
          : [];
      const messages: readonly CapturedMail[] = [...tenantMessages, ...outboxMessages];
      return c.json({ messages });
    },
  });

  const extraSeedRoute = signatureRoute<VerifiedExtraSeed>({
    method: "POST",
    path: SEED_ROUTES.extraSeed,
    entry: "signature",
    verify: async (request) => {
      assertGateOpen(request);
      const parsed = parseOrReject(parseJsonBody(extraSeedRequestSchema, request.rawBody));
      const seeder = Object.hasOwn(extraSeeders, parsed.seeder)
        ? extraSeeders[parsed.seeder]
        : undefined;
      if (seeder === undefined) {
        const registered = Object.keys(extraSeeders).join(", ") || "none";
        throw new ExtraRouteRejection(404, {
          error: `unknown seeder "${parsed.seeder}"; registered: ${registered}`,
        });
      }
      if (!seededTenantIds.has(parsed.tenantId)) {
        throw new ExtraRouteRejection(403, {
          error: `tenant ${parsed.tenantId} was not seeded by this server's seed-tenant route`,
        });
      }
      return {
        seederName: parsed.seeder,
        seeder,
        tenantId: parsed.tenantId,
        body: parsed.body,
      };
    },
    handler: async (c, verified, deps) => {
      const { tenantId } = verified;
      const seederContext: E2eSeederContext = {
        write: async (handlerQn, payload) =>
          unwrapWriteData(
            handlerQn,
            await deps.dispatchSystemWrite({ handlerQn, payload, tenantId }),
          ),
        query: (handlerQn, payload) => deps.dispatchSystemQuery({ handlerQn, payload, tenantId }),
      };
      try {
        const result = await verified.seeder(seederContext, tenantId, verified.body);
        return c.json({ result: result ?? null });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return c.json({ error: `seeder "${verified.seederName}": ${formatIssues(error)}` }, 400);
        }
        return c.json({ error: error instanceof Error ? error.message : "seed failed" }, 500);
      }
    },
  });

  return [seedTenantRoute, seedUserRoute, inboxRoute, extraSeedRoute];
}
