export type Logger = { info(message: string): void; error(message: string): void };
export type Tracer = { span(name: string): void };
export type MetricsHandle = { count(name: string): void };
export type TenantDb = { readonly tenantId: string };
export type WriteResult = { readonly isSuccess: boolean };
export type EventFn = (type: string, payload: unknown) => Promise<void>;

type SharedContextFields = {
  readonly tracer?: Tracer;
};

export type AppContext = SharedContextFields & {
  readonly db?: TenantDb;
  readonly registry?: object;
  readonly log?: Logger;
};

export type HandlerEvents = {
  readonly append: EventFn;
  readonly load: (id: string) => Promise<object>;
};
export type HandlerDispatch = {
  readonly query: (name: string, payload: unknown) => Promise<unknown>;
  readonly write: (name: string, payload: unknown) => Promise<WriteResult>;
  readonly queryAs: (name: string, payload: unknown) => Promise<unknown>;
  readonly writeAs: (name: string, payload: unknown) => Promise<WriteResult>;
  readonly queryAsMember: (query: string) => Promise<unknown>;
};
export type HandlerObservability = {
  readonly log: Logger;
  readonly tracer: Tracer;
  readonly metrics: MetricsHandle;
  readonly metricsFor: (feature: string) => MetricsHandle;
};

export type HandlerContext<TMap extends object = object> = SharedContextFields & {
  readonly db: TenantDb & { readonly outsideTransaction: TenantDb | undefined };
  readonly registry: object;
  readonly events: HandlerEvents;
  readonly dispatch: HandlerDispatch;
  readonly obs: HandlerObservability;
  readonly marker?: TMap;
};

export type JobContext = SharedContextFields & {
  readonly db: TenantDb;
  readonly registry: object;
  readonly events: Pick<HandlerEvents, "append">;
  readonly dispatch: Pick<HandlerDispatch, "write">;
  readonly obs: Pick<HandlerObservability, "log" | "metricsFor">;
};

export type ReservationContext = Omit<HandlerContext, "events" | "dispatch"> & {
  readonly dispatch: Omit<HandlerDispatch, "write" | "writeAs">;
};
export type BeforeTransactionContext = ReservationContext;
export type BeforeTransactionPhase = (event: object, ctx: BeforeTransactionContext) => Promise<void>;

export type BridgeStub = Pick<HandlerContext, "events" | "dispatch">;
