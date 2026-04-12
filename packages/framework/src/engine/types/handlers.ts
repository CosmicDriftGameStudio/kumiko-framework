import type { ZodType } from "zod";
import type { DbConnection } from "../../db/connection";
import type { TenantDb } from "../../db/tenant-db";
import type { Logger } from "../../logging/types";
import type { SearchAdapter } from "../../search/types";

// --- Access ---

export type AccessRule = {
  readonly roles: readonly string[];
};

// --- Pipeline User ---

export type SessionUser = {
  readonly id: number;
  readonly tenantId: number;
  readonly roles: readonly string[];
};

// --- Handler Events ---

export type WriteEvent<TPayload = unknown> = {
  readonly type: string;
  readonly payload: TPayload;
  readonly user: SessionUser;
};

export type QueryEvent<TPayload = unknown> = {
  readonly type: string;
  readonly payload: TPayload;
  readonly user: SessionUser;
};

// --- Handler Results ---

export type WriteResult<TData = unknown> =
  | { readonly isSuccess: true; readonly data: TData }
  | { readonly isSuccess: false; readonly error: string };

// --- Context Types ---

// Forward import: Registry is in feature.ts (circular type import — fine in TS)
import type { Registry } from "./feature";

// Minimal interface for job event triggers (framework-owned, concrete type in jobs/)
export type JobRunnerRef = {
  handleEvent(
    eventName: string,
    payload: Record<string, unknown>,
    user?: SessionUser,
  ): Promise<void>;
};

// Shared optional fields across all execution contexts
type SharedContextFields = {
  readonly redis?: import("ioredis").default;
  readonly jobRunner?: JobRunnerRef;
  readonly configResolver?: unknown; // Typed in core-features (cross-package boundary)
  readonly searchAdapter?: SearchAdapter;
};

// All optional — used at pipeline/system boundaries
export type AppContext = SharedContextFields & {
  readonly db?: DbConnection | TenantDb;
  readonly registry?: Registry;
  readonly systemUser?: SessionUser;
  readonly log?: Logger;
  readonly triggeredBy?: { readonly id: number; readonly tenantId: number } | null;
  readonly _userId?: number | undefined;
  readonly _handlerType?: string | undefined;
};

// Handler execution: db (tenant-scoped) + registry guaranteed
export type HandlerContext = SharedContextFields & {
  readonly db: TenantDb;
  readonly registry: Registry;
  readonly systemUser?: SessionUser;
  readonly log?: Logger;
  readonly triggeredBy?: { readonly id: number; readonly tenantId: number } | null;
  readonly _userId?: number | undefined;
  readonly _handlerType?: string | undefined;
};

// Job execution: db + registry + systemUser + logging guaranteed
export type JobContext = SharedContextFields & {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly systemUser: SessionUser;
  readonly log: Logger;
  readonly triggeredBy: { readonly id: number; readonly tenantId: number } | null;
};

// --- Handler Functions ---

export type WriteHandlerFn<TPayload = unknown, TData = unknown> = (
  event: WriteEvent<TPayload>,
  context: HandlerContext,
) => Promise<WriteResult<TData>>;

export type QueryHandlerFn<TPayload = unknown, TResult = unknown> = (
  query: QueryEvent<TPayload>,
  context: HandlerContext,
) => Promise<TResult>;

// --- Event Definitions ---

export type EventDef<TPayload = unknown> = {
  readonly name: string;
  readonly schema: ZodType<TPayload>;
};

// --- References ---

// Anything that carries a name — accepted by hooks, relations, jobs, etc.
export type NameOrRef = string | { readonly name: string };

export function resolveName(ref: NameOrRef): string {
  return typeof ref === "string" ? ref : ref.name;
}

export type EntityRef = {
  readonly name: string;
  readonly table: string;
};

export type HandlerRef = {
  readonly name: string;
};

export type CrudRefs = {
  readonly entity: EntityRef;
  readonly handlers: {
    readonly create: HandlerRef;
    readonly update: HandlerRef;
    readonly delete: HandlerRef;
  };
  readonly queries: {
    readonly list: HandlerRef;
    readonly detail: HandlerRef;
  };
};

// --- Handler Definitions (stored in feature/registry) ---

export type WriteHandlerDef = {
  readonly name: string;
  readonly schema: ZodType;
  readonly handler: WriteHandlerFn;
  readonly access?: AccessRule;
  readonly skipTransitionGuard?: boolean;
};

export type QueryHandlerDef = {
  readonly name: string;
  readonly schema: ZodType;
  readonly handler: QueryHandlerFn;
  readonly access?: AccessRule;
};
