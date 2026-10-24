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
  readonly scheduleAfterCommit?: (hook: () => Promise<void>) => void;
  readonly configFor?: (tenantId: string) => unknown;
};

export type AppContext = SharedContextFields & {
  readonly services?: never;
  readonly clock?: () => number;
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
  readonly meter?: object;
};

export type ContextServices = {
  readonly redis?: Redis;
  readonly files?: FileContext;
  readonly extensions: Readonly<Record<string, unknown>>;
};
export type HandlerLifecycle = {
  readonly afterCommit?: (hook: () => Promise<void>) => void;
  readonly signal?: AbortSignal;
};
export type HandlerTenants = { readonly config?: (tenantId: string) => unknown };

export type HandlerContext<TMap extends object = object> = {
  readonly db: TenantDb & { readonly outsideTransaction: TenantDb | undefined };
  readonly registry: object;
  readonly events: HandlerEvents;
  readonly dispatch: HandlerDispatch;
  readonly obs: HandlerObservability;
  readonly marker?: TMap;
  readonly services: ContextServices;
  readonly lifecycle: HandlerLifecycle;
  readonly tenants: HandlerTenants;
};

export type JobContext = {
  readonly db: TenantDb;
  readonly registry: object;
  readonly systemUser: SessionUser;
  readonly events: Pick<HandlerEvents, "append">;
  readonly dispatch: Pick<HandlerDispatch, "write">;
  readonly obs: Pick<HandlerObservability, "log" | "metricsFor" | "meter">;
  readonly services: ContextServices;
  readonly lifecycle: Pick<HandlerLifecycle, "signal">;
};

export type ReservationContext = Omit<HandlerContext, "events" | "dispatch"> & {
  readonly dispatch: Omit<HandlerDispatch, "write" | "writeAs">;
};
export type BeforeTransactionContext = ReservationContext;
export type BeforeTransactionPhase = (event: object, ctx: BeforeTransactionContext) => Promise<void>;

export type BridgeStub = Pick<HandlerContext, "events" | "dispatch">;

export type PreSaveHookFn = (
  changes: Record<string, unknown>,
  context: HandlerContext & { readonly isNew: boolean },
) => Promise<Record<string, unknown>>;
export type PostSaveHookFn = (result: object, context: HandlerContext) => Promise<void>;
export declare function onPreSave(fn: PreSaveHookFn): void;
export declare function onPostSave(fn: PostSaveHookFn): void;
export declare function takesAppContext(context: AppContext): void;
