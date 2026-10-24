export type Logger = { info(message: string): void; error(message: string): void };
export type Tracer = { span(name: string): void };
export type MetricsHandle = { count(name: string): void };
export type TenantDb = { readonly tenantId: string };
export type WriteResult = { readonly isSuccess: boolean };
export type Redis = { get(key: string): Promise<string | null> };
export type FileContext = { ref(key: string): string };
export type SessionUser = { readonly id: string; readonly tenantId: string };
export type EventFn = (type: string, payload: unknown) => Promise<void>;

type SharedContextFields = {
  readonly tracer?: Tracer;
  readonly redis?: Redis;
  readonly files?: FileContext;
  readonly signal?: AbortSignal;
  readonly meter?: object;
  readonly scheduleAfterCommit?: (hook: () => Promise<void>) => void;
  readonly configFor?: (tenantId: string) => unknown;
  readonly queryAsMember?: (query: string) => Promise<unknown>;
};

export type AppContext = SharedContextFields & {
  readonly db?: TenantDb;
  readonly registry?: object;
  readonly log?: Logger;
  readonly clock?: () => number;
};

export type HandlerContext<TMap extends object = object> = SharedContextFields & {
  readonly db: TenantDb;
  readonly dbOutsideTransaction: TenantDb | undefined;
  readonly registry: object;
  readonly log?: Logger;
  readonly query: (name: string, payload: unknown) => Promise<unknown>;
  readonly write: (name: string, payload: unknown) => Promise<WriteResult>;
  readonly queryAs: (name: string, payload: unknown) => Promise<unknown>;
  readonly writeAs: (name: string, payload: unknown) => Promise<WriteResult>;
  readonly appendEvent: EventFn;
  readonly loadAggregate: (id: string) => Promise<TMap>;
  readonly tracer: Tracer;
  readonly metrics: MetricsHandle;
  readonly metricsFor: (feature: string) => MetricsHandle;
  readonly queryAsMember: (query: string) => Promise<unknown>;
  readonly systemUser?: SessionUser;
  readonly triggeredBy?: { readonly id: string } | null;
  readonly _tenantId?: string;
};

export type JobContext = SharedContextFields & {
  readonly db: TenantDb;
  readonly registry: object;
  readonly systemUser: SessionUser;
  readonly log: Logger;
  readonly appendEvent: EventFn;
  readonly metricsFor: (feature: string) => MetricsHandle;
  readonly write: (name: string, payload: unknown) => Promise<WriteResult>;
  readonly queryAsMember: (query: string) => Promise<unknown>;
};

export type BeforeTransactionPhase = (event: object, ctx: HandlerContext) => Promise<void>;

export type BridgeStub = Pick<HandlerContext, "query" | "write">;

export type PreSaveHookFn = (
  changes: Record<string, unknown>,
  context: AppContext & { readonly isNew: boolean },
) => Promise<Record<string, unknown>>;
export type PostSaveHookFn = (result: object, context: AppContext) => Promise<void>;
export declare function onPreSave(fn: PreSaveHookFn): void;
export declare function onPostSave(fn: PostSaveHookFn): void;
export declare function takesAppContext(context: AppContext): void;
