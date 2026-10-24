export type Logger = { info(message: string): void; error(message: string): void };
export type Tracer = { span(name: string): void };
export type MetricsHandle = { count(name: string): void };
export type TenantDb = { readonly tenantId: string };
export type WriteResult = { readonly isSuccess: boolean };
export type EventFn = (type: string, payload: unknown) => Promise<void>;

type SharedContextFields = {
  readonly tracer?: Tracer;
  readonly queryAsMember?: (query: string) => Promise<unknown>;
};

export type AppContext = SharedContextFields & {
  readonly db?: TenantDb;
  readonly registry?: object;
  readonly log?: Logger;
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
};

export type JobContext = SharedContextFields & {
  readonly db: TenantDb;
  readonly registry: object;
  readonly log: Logger;
  readonly appendEvent: EventFn;
  readonly metricsFor: (feature: string) => MetricsHandle;
  readonly write: (name: string, payload: unknown) => Promise<WriteResult>;
  readonly queryAsMember: (query: string) => Promise<unknown>;
};

export type BeforeTransactionPhase = (event: object, ctx: HandlerContext) => Promise<void>;

export type BridgeStub = Pick<HandlerContext, "query" | "write">;
